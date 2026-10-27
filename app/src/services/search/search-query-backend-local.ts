import {
  SearchQueryExpressionVisitor,
  OrQueryExpression,
  NotQueryExpression,
  AndQueryExpression,
  DateQueryExpression,
  UnreadStatusQueryExpression,
  StarredStatusQueryExpression,
  HasAttachmentQueryExpression,
  MatchQueryExpression,
  QueryExpression,
  SizeQueryExpression,
  GenericQueryExpression,
} from './search-query-ast';
import { DateUtils } from 'summermail-exports';
import { messageSizeSQL } from '../mail-sort';

/*
 * This class visits a match-compatible subtree and condenses it into a single
 * MatchQueryExpression.
 */
class MatchQueryExpressionVisitor extends SearchQueryExpressionVisitor {
  visit(root) {
    const result = this.visitAndGetResult(root);
    return new MatchQueryExpression(`${result}`);
  }

  _assertIsMatchCompatible(node) {
    if (!node.isMatchCompatible()) {
      throw new Error(`Expected ${node} to be match compatible`);
    }
  }

  visitAnd(node) {
    this._assertIsMatchCompatible(node);
    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = `(${lhs} AND ${rhs})`;
  }

  visitNot(node) {
    this._assertIsMatchCompatible(node);
    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = `(${lhs} NOT ${rhs})`;
  }

  visitOr(node) {
    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = `(${lhs} OR ${rhs})`;
  }

  visitDate(node) {}

  visitFrom(node) {
    const text = this.visitAndGetResult(node.text);
    this._result = `(from_ : "${text}"*)`;
  }

  visitTo(node) {
    const text = this.visitAndGetResult(node.text);
    this._result = `(to_ : "${text}"*)`;
  }

  visitSubject(node) {
    const text = this.visitAndGetResult(node.text);
    this._result = `(subject : "${text}"*)`;
  }

  visitBody(node) {
    const text = this.visitAndGetResult(node.text);
    this._result = `(body : "${text}"*)`;
  }

  visitGeneric(node) {
    const text = this.visitAndGetResult(node.text);
    this._result = `("${text}"*)`;
  }

  visitText(node) {
    // Escape double quotes for FTS5 quoted string context. The callers
    // (visitFrom, visitTo, visitSubject, visitGeneric, visitIn) all wrap
    // this text in double quotes, so the only character that needs escaping
    // is the double quote itself (doubled per FTS5 spec). All other special
    // FTS5 characters are neutralized by being inside the quoted phrase.
    this._result = node.token.s.replace(/"/g, '""');
  }

  visitUnread(node) {
    this._assertIsMatchCompatible(node);
  }

  visitStarred(node) {
    this._assertIsMatchCompatible(node);
  }

  visitIn(node) {
    const text = this.visitAndGetResult(node.text);
    this._result = `(categories : "${text}"*)`;
  }

  visitHasAttachment(node) {
    this._assertIsMatchCompatible(node);
  }
}

/*
 * This class creates a new AST by converting match-compatible subtrees into
 * MatchQueryExpressions.
 */
class MatchCompatibleQueryCondenser extends SearchQueryExpressionVisitor {
  private _matchVisitor = new MatchQueryExpressionVisitor();

  constructor(private _includeAttachments = false) {
    super();
  }

  _canCondense(node: QueryExpression) {
    return (
      node.isMatchCompatible() && (!this._includeAttachments || !hasAttachmentSearchTerms(node))
    );
  }

  visit(root: QueryExpression) {
    return this.visitAndGetResult(root);
  }

  visitAnd(node) {
    if (this._canCondense(node)) {
      this._result = this._matchVisitor.visit(node);
      return;
    }

    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = new AndQueryExpression(lhs, rhs);
  }

  visitOr(node) {
    if (this._canCondense(node)) {
      this._result = this._matchVisitor.visit(node);
      return;
    }

    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = new OrQueryExpression(lhs, rhs);
  }

  visitNot(node) {
    if (this._canCondense(node)) {
      this._result = this._matchVisitor.visit(node);
      return;
    }
    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = new NotQueryExpression(lhs, rhs);
  }

  visitFrom(node) {
    this._result = this._matchVisitor.visit(node);
  }

  visitTo(node) {
    this._result = this._matchVisitor.visit(node);
  }

  visitSubject(node) {
    this._result = this._matchVisitor.visit(node);
  }

  visitBody(node) {
    this._result = this._matchVisitor.visit(node);
  }

  visitGeneric(node) {
    this._result = this._includeAttachments ? node : this._matchVisitor.visit(node);
  }

  visitText(node) {
    this._result = this._matchVisitor.visit(node);
  }

  visitIn(node) {
    this._result = this._matchVisitor.visit(node);
  }

  visitUnread(node) {
    this._result = new UnreadStatusQueryExpression(node.status);
  }

  visitDate(node) {
    this._result = new DateQueryExpression(node.text, node.direction);
  }

  visitStarred(node) {
    this._result = new StarredStatusQueryExpression(node.status);
  }

  visitHasAttachment(/* node */) {
    this._result = new HasAttachmentQueryExpression();
  }

  visitSize(node: SizeQueryExpression) {
    this._result = new SizeQueryExpression(node.bytes, node.comparison);
  }
}

export function compileFTSMatchQuery(ast: QueryExpression): string | null {
  const intermediateAST = new MatchCompatibleQueryCondenser().visit(ast);
  return intermediateAST instanceof MatchQueryExpression ? intermediateAST.rawQuery : null;
}

export function hasAttachmentSearchTerms(ast: QueryExpression): boolean {
  if (ast instanceof GenericQueryExpression) return true;
  if (
    ast instanceof AndQueryExpression ||
    ast instanceof OrQueryExpression ||
    ast instanceof NotQueryExpression
  ) {
    return hasAttachmentSearchTerms(ast.e1) || hasAttachmentSearchTerms(ast.e2);
  }
  return false;
}

/*
 * Converts a search query into the appropriate where clause. It does this by
 * converting match-compatible subtrees into the appropriate subquery that
 * uses a MATCH clause.
 */
class StructuredSearchQueryVisitor extends SearchQueryExpressionVisitor {
  private _className: string;

  constructor(className) {
    super();
    this._className = className;
  }

  visit(root) {
    return this.visitAndGetResult(root);
  }

  visitNot(node) {
    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = `(${lhs} AND NOT ${rhs})`;
  }

  visitAnd(node) {
    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = `(${lhs} AND ${rhs})`;
  }

  visitOr(node) {
    const lhs = this.visitAndGetResult(node.e1);
    const rhs = this.visitAndGetResult(node.e2);
    this._result = `(${lhs} OR ${rhs})`;
  }

  visitFrom(node) {
    throw new Error(`Unreachable: ${node}`);
  }

  visitTo(node) {
    throw new Error(`Unreachable: ${node}`);
  }

  visitSubject(node) {
    throw new Error(`Unreachable: ${node}`);
  }

  visitBody(node) {
    throw new Error(`Unreachable: ${node}`);
  }

  visitGeneric(node) {
    const rawPhrase = `"${node.text.token.s.replace(/"/g, '""')}"*`;
    const phrase = rawPhrase.replace(/'/g, "''");
    this.visitMatch(new MatchQueryExpression(`(${rawPhrase})`));
    const mailMatch = this._result;
    // Join live message ownership and the current MIME part list. Cached text
    // can never resurrect a removed attachment or an old conversation ID.
    const attachmentMatch = `\`Thread\`.id IN (
      SELECT attachmentMessage.threadId FROM attachmentSearch.AttachmentText
      JOIN Message attachmentMessage ON attachmentMessage.id = AttachmentText.messageId
        AND attachmentMessage.accountId = AttachmentText.accountId
      WHERE AttachmentText MATCH '${phrase}'
        AND EXISTS (SELECT 1 FROM json_each(attachmentMessage.data, '$.files') attachmentFile
          WHERE json_extract(attachmentFile.value, '$.id') = AttachmentText.fileId)
    )`;
    this._result = `(${mailMatch} OR (${attachmentMatch}))`;
  }

  visitText(node) {
    throw new Error(`Unreachable: ${node}`);
  }

  visitIn(node) {
    throw new Error(`Unreachable: ${node}`);
  }

  visitUnread(node) {
    this._result = `(\`${this._className}\`.\`unread\` ${node.status ? '>' : '='} 0)`;
  }

  visitStarred(node) {
    this._result = `(\`${this._className}\`.\`starred\` ${node.status ? '>' : '='} 0)`;
  }

  visitHasAttachment(/* node */) {
    const data = `\`${this._className}\`.\`data\``;
    const metadataHasAttachment = (messageData: string) =>
      `(COALESCE(json_extract(${messageData}, '$.smHasAttachments'), 0) = 1 OR COALESCE(json_array_length(${messageData}, '$.files'), 0) > 0)`;
    if (this._className === 'Thread') {
      // SmarterMail lists know an attachment exists before its MIME parts are
      // hydrated. Thread.attachmentCount only counts materialized File models.
      // Preserve that cheap provider signal so older unopened mail is searchable.
      const messageMatch = metadataHasAttachment('attachmentMessage.data');
      const messageExists = `EXISTS (SELECT 1 FROM \`Message\` attachmentMessage WHERE attachmentMessage.threadId = \`Thread\`.id AND ${messageMatch})`;
      this._result = `(COALESCE(json_extract(${data}, '$.attachmentCount'), 0) > 0 OR ${messageExists})`;
    } else {
      this._result = metadataHasAttachment(data);
    }
  }

  visitDate(node) {
    const comparator = node.direction === 'before' ? '<' : '>';
    const date = DateUtils.getChronoPast().parseDate(node.text.token.s);
    if (!date) {
      this._result = '';
      return;
    }
    const ts = Math.floor(date.getTime() / 1000);
    this._result = `(\`${this._className}\`.\`lastMessageReceivedTimestamp\` ${comparator} ${ts})`;
  }

  visitSize(node: SizeQueryExpression) {
    if (this._className === 'Thread') {
      this._result = `EXISTS (SELECT 1 FROM \`Message\` sizeMessage WHERE sizeMessage.threadId = \`Thread\`.id AND ${messageSizeSQL('sizeMessage')} ${node.comparison} ${node.bytes})`;
    } else {
      this._result = `(${messageSizeSQL(`\`${this._className}\``)} ${node.comparison} ${node.bytes})`;
    }
  }

  visitMatch(node) {
    const searchTable = `${this._className}Search`;

    // in sqlite3, you use '' to escape a '. Weird right?
    const escaped = node.rawQuery.replace(/'/g, "''");

    this._result = `(\`${this._className}\`.\`id\` IN (SELECT \`content_id\` FROM \`${searchTable}\` WHERE \`${searchTable}\` MATCH '${escaped}'))`;
  }
}

export default class LocalSearchQueryBackend {
  private _modelClassName: string;

  constructor(modelClassName) {
    this._modelClassName = modelClassName;
  }

  compile(ast: QueryExpression) {
    const condenser = new MatchCompatibleQueryCondenser(this._modelClassName === 'Thread');
    const intermediateAST = condenser.visit(ast);

    const codegen = new StructuredSearchQueryVisitor(`${this._modelClassName}`);
    return codegen.visit(intermediateAST);
  }
}
