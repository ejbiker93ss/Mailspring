import _ from 'underscore';
import {
  Actions,
  Thread,
  DatabaseStore,
  SearchQueryParser,
  ComponentRegistry,
  MutableQuerySubscription,
} from 'summermail-exports';
import { compileFTSMatchQuery } from '../../../src/services/search/search-query-backend-local';
import {
  FromQueryExpression,
  QueryExpression,
  ToQueryExpression,
} from '../../../src/services/search/search-query-ast';

type RankedSearchResult = {
  ids: string[];
  total: number;
  matchingMessageIds: Map<string, string>;
};

type AddressOperator = {
  field: 'from' | 'to';
  value: string;
};

// FTS5's BM25 scores are negative (more negative is a stronger match). Group
// nearby scores so small ranking differences do not bury recent messages, while
// still allowing a materially stronger match to outrank a newer weak match.
const RELEVANCE_BAND_WIDTH = 1.5;

class RankedIdSortOrder {
  attr = Thread.attributes.lastMessageReceivedTimestamp;
  private _ids: string[];

  constructor(ids: string[]) {
    this._ids = ids;
  }

  orderBySQL(klass: typeof Thread) {
    const cases = this._ids
      .map((id, index) => `WHEN '${id.replace(/'/g, "''")}' THEN ${index}`)
      .join(' ');
    return `(CASE \`${klass.name}\`.\`id\` ${cases} ELSE ${this._ids.length} END) ASC`;
  }
}

function exactAddressOperator(ast: QueryExpression): AddressOperator | null {
  if (!(ast instanceof FromQueryExpression) && !(ast instanceof ToQueryExpression)) {
    return null;
  }
  const value = ast.text.token.s.trim().toLowerCase();
  if (!value.includes('@')) {
    return null;
  }
  return { field: ast instanceof FromQueryExpression ? 'from' : 'to', value };
}

function jsonAddressMatchSQL(messageAlias: string, operator: AddressOperator) {
  const paths = operator.field === 'from' ? ['from'] : ['to', 'cc', 'bcc'];
  return `(${paths
    .map(
      (path) =>
        `EXISTS (SELECT 1 FROM json_each(${messageAlias}.data, '$.${path}') address WHERE lower(json_extract(address.value, '$.email')) = ?)`
    )
    .join(' OR ')})`;
}

function addressValues(operator: AddressOperator) {
  return operator.field === 'from'
    ? [operator.value]
    : [operator.value, operator.value, operator.value];
}

export class SearchQuerySubscription extends MutableQuerySubscription<Thread> {
  _searchQuery: string;
  _accountIds: string[];
  _connections = [];
  _extDisposables = [];
  _searching = false;
  _resultCount: number | null = null;
  _matchingMessageIds = new Map<string, string>();

  constructor(searchQuery: string, accountIds: string[]) {
    super(null, { emitResultSet: true });
    this._searchQuery = searchQuery;
    this._accountIds = accountIds;

    _.defer(() => this.performSearch());
  }

  replaceRange = () => {
    // TODO
  };

  performSearch() {
    this._searching = true;
    this.performLocalSearch();
    this.performExtensionSearch();
  }

  async performLocalSearch() {
    let dbQuery = DatabaseStore.findAll<Thread>(Thread);
    if (this._accountIds.length === 1) {
      dbQuery = dbQuery.where({ accountId: this._accountIds[0] });
    } else if (this._accountIds.length > 1) {
      dbQuery = dbQuery.where(Thread.attributes.accountId.in(this._accountIds));
    }

    let parsedQuery: QueryExpression | null = null;
    try {
      parsedQuery = SearchQueryParser.parse(this._searchQuery);
    } catch (error) {
      console.info('Failed to parse local search query, falling back to generic query', error);
    }

    if (parsedQuery) {
      dbQuery = dbQuery.structuredSearch(parsedQuery);
      try {
        const ranked = await this._rankedSearchResults(parsedQuery);
        if (ranked) {
          this._resultCount = ranked.total;
          this._matchingMessageIds = ranked.matchingMessageIds;
          dbQuery = dbQuery.where({
            id: ranked.ids.length ? ranked.ids : ['__no_search_results__'],
          });
          if (ranked.ids.length) {
            dbQuery = dbQuery.order(new RankedIdSortOrder(ranked.ids) as any);
          }
        } else {
          this._resultCount = (await dbQuery.clone().count().background()) as unknown as number;
        }
      } catch (error) {
        console.warn('Search relevance ranking failed; using chronological results', error);
        this._resultCount = null;
        this._matchingMessageIds.clear();
      }
    } else {
      dbQuery = dbQuery.search(this._searchQuery);
      this._resultCount = (await dbQuery.clone().count().background()) as unknown as number;
    }
    dbQuery = dbQuery
      .background()
      .order(Thread.attributes.lastMessageReceivedTimestamp.descending())
      .limit(1000);

    this.replaceQuery(dbQuery);
  }

  async _rankedSearchResults(parsedQuery: QueryExpression): Promise<RankedSearchResult | null> {
    const ftsQuery = compileFTSMatchQuery(parsedQuery);
    if (!ftsQuery) {
      return null;
    }

    const operator = exactAddressOperator(parsedQuery);
    const accountSQL = this._accountIds.length
      ? `AND \`Thread\`.\`accountId\` IN (${this._accountIds.map(() => '?').join(', ')})`
      : '';
    const strictMessageSQL = operator
      ? `AND EXISTS (SELECT 1 FROM \`Message\` strictMessage WHERE strictMessage.threadId = \`Thread\`.id AND ${jsonAddressMatchSQL(
          'strictMessage',
          operator
        )})`
      : '';
    const matchCountSQL = operator
      ? `(SELECT COUNT(*) FROM \`Message\` matchedMessage WHERE matchedMessage.threadId = \`Thread\`.id AND ${jsonAddressMatchSQL(
          'matchedMessage',
          operator
        )})`
      : '0';
    const matchingMessageIdSQL = operator
      ? `(SELECT matchedMessage.id FROM \`Message\` matchedMessage WHERE matchedMessage.threadId = \`Thread\`.id AND ${jsonAddressMatchSQL(
          'matchedMessage',
          operator
        )} ORDER BY matchedMessage.date DESC LIMIT 1)`
      : 'NULL';
    const fromAndWhere = `FROM \`ThreadSearch\` JOIN \`Thread\` ON \`Thread\`.id = \`ThreadSearch\`.content_id WHERE \`ThreadSearch\` MATCH ? ${accountSQL} ${strictMessageSQL}`;

    const rankValues = [
      ...(operator ? addressValues(operator) : []),
      ...(operator ? addressValues(operator) : []),
      ftsQuery,
      ...this._accountIds,
      ...(operator ? addressValues(operator) : []),
    ];
    const countValues = [
      ftsQuery,
      ...this._accountIds,
      ...(operator ? addressValues(operator) : []),
    ];
    // ThreadSearch columns are subject, to, from, body, categories, and content_id.
    // Favor intent-bearing metadata over incidental body text; content_id is unindexed.
    const bm25SQL = 'bm25(`ThreadSearch`, 12, 6, 8, 1, 3, 0)';
    const relevanceBandSQL = `CAST(${bm25SQL} / ${RELEVANCE_BAND_WIDTH} AS INTEGER)`;
    const rankSQL = `SELECT \`ThreadSearch\`.content_id AS id, ${matchingMessageIdSQL} AS matchingMessageId, ${bm25SQL} AS relevance, ${relevanceBandSQL} AS relevanceBand, ${matchCountSQL} AS exactMatches ${fromAndWhere} ORDER BY exactMatches DESC, relevanceBand ASC, \`Thread\`.lastMessageReceivedTimestamp DESC, relevance ASC LIMIT 1000`;
    const countSQL = `SELECT COUNT(*) AS count ${fromAndWhere}`;

    const [rows, countRows] = await Promise.all([
      (DatabaseStore as any)._query(rankSQL, rankValues, true),
      (DatabaseStore as any)._query(countSQL, countValues, true),
    ]);
    return {
      ids: rows.map((row) => row.id),
      total: Number(countRows[0]?.count || 0),
      matchingMessageIds: new Map(
        rows.filter((row) => row.matchingMessageId).map((row) => [row.id, row.matchingMessageId])
      ),
    };
  }

  matchingMessageIdForThread(threadId: string) {
    return this._matchingMessageIds.get(threadId) || null;
  }

  _createResultAndTrigger() {
    super._createResultAndTrigger();
    if (this._searching) {
      this._searching = false;
      Actions.searchCompleted(this._resultCount);
    }
  }

  _handleQueryError(error: Error) {
    console.error('Search query failed', error);
    if (this._searching) {
      this._searching = false;
      Actions.searchCompleted(null);
    }
  }

  _addThreadIdsToSearch(ids: string[] = []) {
    const currentResults = this._set && this._set.ids().length > 0;
    let searchIds = ids;
    if (currentResults) {
      const currentResultIds = this._set.ids();
      searchIds = [...new Set(currentResultIds.concat(ids))];
    }
    const dbQuery = DatabaseStore.findAll<Thread>(Thread)
      .where({ id: searchIds })
      .order(Thread.attributes.lastMessageReceivedTimestamp.descending());
    this.replaceQuery(dbQuery);
  }

  performRemoteSearch() {
    // TODO: Perform IMAP search here.
    //
    // This is temporarily disabled because we support Gmail's
    // advanced syntax locally (eg: in: inbox, is:unread), and
    // search message bodies, so local search is pretty much
    // good enough for v1. Come back and implement this soon!
    //
  }

  performExtensionSearch() {
    const searchExtensions = ComponentRegistry.findComponentsMatching({
      role: 'SearchBarResults',
    });

    this._extDisposables = searchExtensions.map((ext) => {
      return ext.observeThreadIdsForQuery(this._searchQuery).subscribe((ids = []) => {
        const allIds = ids.flat().filter(Boolean);
        if (allIds.length === 0) return;
        this._addThreadIdsToSearch(allIds);
      });
    });
  }

  onLastCallbackRemoved() {
    this._connections.forEach((conn) => conn.end());
    this._extDisposables.forEach((disposable) => disposable.dispose());
  }
}

export default SearchQuerySubscription;
