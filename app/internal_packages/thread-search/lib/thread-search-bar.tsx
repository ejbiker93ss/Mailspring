import React, { Component } from 'react';
import { ListensToFluxStore, RetinaImg, KeyCommandsRegion } from 'summermail-component-kit';
import {
  localized,
  Actions,
  FocusedPerspectiveStore,
  WorkspaceStore,
  MailboxPerspective,
  AccountStore,
} from 'summermail-exports';
import SearchStore from './search-store';
import SearchQueryEditor from './search-query-editor';
import { SearchSuggestionsPopover } from './search-suggestions-popover';
import {
  ThreadSearchSuggestion,
  emptyQuerySuggestions,
  freeTextSuggestions,
  operatorSuggestions,
} from './search-suggestions';
import { SearchRefinement, toggleRefinement } from './search-refinements';
import { rememberSearch, forgetSearch } from './recent-searches';
import { interpretNaturalLanguageQuery } from './natural-language-query';

import {
  TokenSuggestions,
  TokenSuggestionsForEmpty,
  TokenAndTermRegexp,
  getCurrentTokenAndTerm,
  wrapInQuotes,
} from './search-bar-util';

const MAIL_TOOLBAR_HEIGHT = 34;
const SIDE_PANEL_SELECTOR = '.column-CalendarSidebar, .toolbar-CalendarSidebar';

interface ThreadSearchBarProps {
  query: string;
  isSearching: boolean;
  resultCount: number | null;
  perspective: MailboxPerspective;
}

interface ThreadSearchBarState {
  suggestions: ThreadSearchSuggestion[];
  focused: boolean;
  selected?: ThreadSearchSuggestion;
  selectedIdx: number;
  // The free text being typed, used to highlight matches in suggestions.
  highlight: string;
  showRefinements: boolean;
}

export class ThreadSearchBar extends Component<ThreadSearchBarProps, ThreadSearchBarState> {
  static displayName = 'ThreadSearchBar';

  _fieldEl: SearchQueryEditor;
  _setFieldRef = (el: SearchQueryEditor) => (this._fieldEl = el);
  _suggestionRequest = 0;
  _queryRegion: HTMLDivElement;
  _resizeObserver?: ResizeObserver;
  _layoutRoot?: HTMLElement;

  componentDidMount() {
    const bar = this._queryRegion.parentElement;
    this._layoutRoot = bar.closest('.sheet-toolbar')?.parentElement;
    this._resizeObserver = new ResizeObserver(this._updateSearchLayout);
    this._resizeObserver.observe(bar);
    this._resizeObserver.observe(document.documentElement);
    const toolbar = this._queryRegion.closest('.toolbar-ThreadList');
    if (toolbar) this._resizeObserver.observe(toolbar);
    this._updateSearchLayout();
  }

  _updateSearchLayout = () => {
    const bar = this._queryRegion.parentElement;
    const toolbar = bar.closest('.toolbar-ThreadList');
    if (!toolbar) return;
    const controls = toolbar.querySelector('.thread-list-controls');
    const available = this._expansionRightEdge() - bar.getBoundingClientRect().left;
    // Leave room for the list controls, view selector, and toolbar gaps.
    const controlsWidth = (controls?.getBoundingClientRect().width || 0) + 64;
    const width = Math.min(840, Math.max(88, available - controlsWidth));
    bar.style.setProperty('--search-expanded-width', `${width}px`);
    // Reserve the wrapped field's height in the mail columns. Suggestions are
    // absolutely positioned and remain a popup rather than moving the list.
    const height = Math.max(
      MAIL_TOOLBAR_HEIGHT,
      Math.ceil(bar.getBoundingClientRect().bottom - toolbar.getBoundingClientRect().top + 1)
    );
    this._layoutRoot?.style.setProperty('--mail-search-toolbar-height', `${height}px`);
  };

  // The expanded field may cover the reading pane, but not a docked side
  // panel such as the calendar sidebar, or the list controls land on top of it.
  _expansionRightEdge() {
    const panels = Array.from(
      this._layoutRoot?.querySelectorAll<HTMLElement>(SIDE_PANEL_SELECTOR) || []
    );
    return panels
      .map((panel) => panel.getBoundingClientRect())
      .filter((rect) => rect.width > 0)
      .reduce((edge, rect) => Math.min(edge, rect.left), window.innerWidth);
  }

  componentWillUnmount() {
    this._suggestionRequest++;
    this._resizeObserver?.disconnect();
    this._layoutRoot?.style.removeProperty('--mail-search-toolbar-height');
  }

  constructor(props: ThreadSearchBarProps) {
    super(props);
    this.state = {
      suggestions: emptyQuerySuggestions(),
      focused: false,
      selected: null,
      selectedIdx: -1,
      highlight: '',
      showRefinements: false,
    };
  }

  componentDidUpdate(prevProps: ThreadSearchBarProps) {
    if (prevProps.query !== this.props.query) {
      this._generateSuggestionsForQuery(this.props.query);
    }
  }

  _initialQueryForPerspective() {
    const { perspective } = this.props;

    // When the inbox is focused we don't specify a folder scope. If the user
    // wants to search just the inbox then they have to specify it explicitly.
    if ('starred' in perspective) {
      return 'is:starred ';
    }
    if ('unread' in perspective) {
      return 'is:unread in:inbox ';
    }
    if (perspective.isInbox()) {
      return '';
    }
    const rolesAndPaths = [
      ...new Set(perspective.categories().map((c) => c.role || wrapInQuotes(c.path))),
    ];
    if (rolesAndPaths.length > 1) {
      return `(in:${rolesAndPaths.join(' OR in:')}) `;
    } else if (rolesAndPaths.length === 1) {
      return `in:${rolesAndPaths[0]} `;
    } else {
      return '';
    }
  }

  // Treat the initial query (eg: "in:starred AND ") as if it's not there, so
  // the user sees the empty string case at first, etc.
  _perspectivePrefix(query: string) {
    const initialQuery = this._initialQueryForPerspective();
    return initialQuery && query.startsWith(initialQuery) ? initialQuery : '';
  }

  _withoutPrefix(query: string) {
    return query.substr(this._perspectivePrefix(query).length);
  }

  _smartQueryFor(query: string) {
    const prefix = this._perspectivePrefix(query);
    const smart = interpretNaturalLanguageQuery(query.substr(prefix.length));
    return smart ? `${prefix}${smart.query} ` : query;
  }

  async _generateSuggestionsForQuery(query: string) {
    const request = ++this._suggestionRequest;
    let insertionIndex = this._fieldEl.insertionIndex();

    const prefix = this._perspectivePrefix(query);
    query = query.substr(prefix.length);
    insertionIndex -= prefix.length;
    const hasQuery = query.trim().length > 0;

    if (this._fieldEl.isAppending()) {
      this._setSuggestionState(operatorSuggestions(TokenSuggestionsForEmpty), {
        showRefinements: hasQuery,
      });
      return;
    }

    const { token, term } = getCurrentTokenAndTerm(query, insertionIndex);
    if (token) {
      const values = await this._tokenSuggestions(token, term);
      if (request === this._suggestionRequest) this._setSuggestionState(values);
      return;
    }
    if (!hasQuery) {
      this._setSuggestionState(emptyQuerySuggestions());
      return;
    }

    // Gmail-style people and message lookups only make sense for plain text;
    // the smart reading also works alongside filters already in the query.
    const includeLookups = query.length > 2 && TokenAndTermRegexp().test(query.trim()) === false;
    const suggestions = await freeTextSuggestions(
      query,
      prefix,
      this.props.perspective.accountIds,
      { includeLookups }
    );
    if (request === this._suggestionRequest) {
      this._setSuggestionState(suggestions, {
        highlight: includeLookups ? query : '',
        showRefinements: true,
      });
    }
  }

  async _tokenSuggestions(token: string, term: string): Promise<ThreadSearchSuggestion[]> {
    // show token autocompletion options ala Stripe Dashboard
    const operators = TokenSuggestions.filter((s) => s.token.startsWith(token));
    if (!operators.length || operators[0].token !== token) {
      return operatorSuggestions(operators);
    }
    const { termSuggestions } = operators[0];
    const values =
      termSuggestions instanceof Function
        ? await termSuggestions(term, this.props.perspective.accountIds)
        : termSuggestions.filter((t) => !term || (t.startsWith(term) && t !== term));
    return values.map((value: string) => ({
      kind: 'value',
      term: wrapInQuotes(value),
      description: value.includes(' ') ? wrapInQuotes(value) : value,
      token,
    }));
  }

  _onFocus = (e: React.FocusEvent) => {
    this.setState({ focused: true });
    if (this.props.query === '') {
      this._onSearchQueryChanged(this._initialQueryForPerspective());
      window.requestAnimationFrame(() => this._fieldEl.focus());
    }
  };

  _onBlur = (e: React.FocusEvent) => {
    this.setState({ focused: false });
    if (this.props.query === this._initialQueryForPerspective()) {
      this._onSearchQueryChanged('');
    }
    // Chromium may scroll the contenteditable vertically while moving the
    // caret during blur. Reset it after that browser work so the placeholder
    // returns to its centered resting position.
    window.requestAnimationFrame(() => this._fieldEl && this._fieldEl.resetScrollPosition());
  };

  _onKeyDown = (e: React.KeyboardEvent) => {
    const { suggestions, selected, selectedIdx } = this.state;
    const key =
      e.key ||
      ({ 40: 'ArrowDown', 38: 'ArrowUp', 27: 'Escape', 13: 'Enter' } as Record<number, string>)[
        e.keyCode
      ];
    const delta = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[key];

    if (delta) {
      e.preventDefault();

      const nextIdx = Math.min(suggestions.length - 1, Math.max(0, selectedIdx + delta));

      this.setState({
        selectedIdx: nextIdx,
        selected: suggestions[nextIdx],
      });
    }

    if (key === 'Escape') {
      // escape
      e.preventDefault();
      this._onClearSearchQuery(e);
    }
    if (
      key === 'Tab' &&
      !e.shiftKey &&
      (selected?.kind === 'operator' || selected?.kind === 'value')
    ) {
      // Tab completes the highlighted filter, as in a code editor.
      e.preventDefault();
      this._onChooseSuggestion(selected);
      return;
    }
    if (key === 'Delete' && e.shiftKey && selected?.kind === 'recent') {
      e.preventDefault();
      this._onForgetSuggestion(selected);
      return;
    }
    if (key === 'Enter' || key === 'Return') {
      // return
      e.preventDefault();
      const value = this._fieldEl.value();
      if (selected?.source !== undefined && selected.source !== this._withoutPrefix(value)) {
        // Suggestions arrive asynchronously; when Enter beats them, apply the
        // same reading to the text as it is now.
        this._onSubmitSearchQuery(selected.kind === 'smart' ? this._smartQueryFor(value) : value);
      } else if (selected) {
        this._onChooseSuggestion(selected);
      } else {
        // The connected query prop can still contain the previous value when
        // input and keydown are batched together. Submit what is actually in
        // the editor so pressing Enter never searches for an empty/stale term.
        this._onSubmitSearchQuery(this._fieldEl.value());
      }
    }
  };

  _onChooseSuggestion = (suggestion: ThreadSearchSuggestion) => {
    if (suggestion.thread && WorkspaceStore.layoutMode() !== 'list') {
      Actions.setFocus({ collection: 'thread', item: suggestion.thread });
    }
    if (suggestion.query) {
      this._onSubmitSearchQuery(suggestion.query);
      return;
    }

    const query = this._fieldEl.value();

    let nextQuery = null;

    // If the user has the cursor inside an existing token, replace it. If the query ends
    // in a space, append a new token. Otherwise replace the whole string.
    let { index, length } = getCurrentTokenAndTerm(query, this._fieldEl.insertionIndex());
    if (this._fieldEl.isAppending() || (index === -1 && query.endsWith(' '))) {
      index = query.length;
      length = 0;
    }

    if (suggestion.token) {
      nextQuery = [
        query.substr(0, index).trim(),
        `${suggestion.token}:${suggestion.term}`,
        query.substr(index + length).trim(),
      ]
        .filter((s) => s.length)
        .join(' ');
    } else {
      nextQuery = suggestion.term;
    }

    if (!nextQuery.endsWith(' ')) {
      nextQuery = nextQuery + ' ';
    }
    if (suggestion.term) {
      this._onSubmitSearchQuery(nextQuery);
    } else {
      this._onSearchQueryChanged(nextQuery);
    }
  };

  _onForgetSuggestion = (suggestion: ThreadSearchSuggestion) => {
    forgetSearch(suggestion.query);
    this._setSuggestionState(this.state.suggestions.filter((s) => s !== suggestion));
  };

  // Refinements apply immediately and keep the popover open so several can be
  // combined in a row.
  _onRefine = (refinement: SearchRefinement) => {
    const next = toggleRefinement(this._fieldEl.value(), refinement);
    rememberSearch(next);
    Actions.searchQuerySubmitted(next);
  };

  _onSearchQueryChanged = async (query: string) => {
    if (query === this.props.query) {
      return;
    }
    Actions.searchQueryChanged(query);
    if (query === '') {
      this._onClearSearchQuery();
    }
  };

  _setSuggestionState = (
    suggestions: ThreadSearchSuggestion[],
    { highlight = '', showRefinements = false } = {}
  ) => {
    const { selected } = this.state;
    const sameItemIdx = suggestions.findIndex(
      (s) => selected && s.kind === selected.kind && s.description === selected.description
    );
    const backupIdx = Math.max(-1, Math.min(this.state.selectedIdx, suggestions.length - 1));
    // A smart reading is preselected so Enter applies it; the literal search is
    // one arrow press away.
    const preferredIdx = suggestions[0]?.kind === 'smart' ? 0 : backupIdx;
    const selectedIdx = sameItemIdx !== -1 ? sameItemIdx : preferredIdx;

    this.setState({
      suggestions,
      selectedIdx,
      selected: selectedIdx !== -1 ? suggestions[selectedIdx] : null,
      highlight,
      showRefinements,
    });
  };

  _onSubmitSearchQuery = (nextQuery: string) => {
    if (nextQuery.trim() !== this._initialQueryForPerspective().trim()) {
      rememberSearch(nextQuery);
    }
    Actions.searchQuerySubmitted(nextQuery);
    this._fieldEl.blur();
  };

  _onClearSearchQuery = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (this.props.query !== '') {
      Actions.searchQuerySubmitted('');
    } else {
      this._fieldEl.blur();
    }
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  _placeholder = () => {
    if (this._initialQueryForPerspective() === '') {
      const countMailboxes = FocusedPerspectiveStore.current()?.accountIds?.length || 0;
      if (countMailboxes == 1) {
        const account = AccountStore.accountForId(FocusedPerspectiveStore.current().accountIds[0]);
        return localized('Search') + ' ' + account.label;
      } else {
        return localized('Search all mailboxes');
      }
    }
    return localized(`Search`) + ' ' + this.props.perspective.name || '';
  };

  render() {
    const { query, isSearching, resultCount } = this.props;
    const { suggestions, selectedIdx, highlight, showRefinements } = this.state;

    const showPlaceholder = !this.state.focused && !query;
    const showX = this.state.focused || !!query;

    const suggestionsVisible = this.state.focused && (suggestions.length > 0 || showRefinements);

    return (
      <KeyCommandsRegion
        className={`thread-search-bar ${showPlaceholder ? 'placeholder' : ''} ${this.state.focused ? 'is-focused' : ''} ${query ? 'has-query' : ''}`}
        role="combobox"
        aria-expanded={suggestionsVisible}
        aria-haspopup="listbox"
        onMouseDown={(event: React.MouseEvent) => {
          if (
            (event.target as HTMLElement).closest(
              'input, select, button, .search-accessory, .suggestions'
            )
          )
            return;
          event.preventDefault();
          this._fieldEl.focusEnd();
        }}
        globalHandlers={{
          'core:focus-search': () => {
            // If the user is in list mode, we need to clear the selection because the
            // thread action bar appears over the search bar. Kind of a hack.
            if (WorkspaceStore.layoutMode() === 'list') {
              AppEnv.commands.dispatch('multiselect-list:deselect-all');
            }
            Actions.popSheet();
            this._fieldEl.focus();
          },
        }}
      >
        {isSearching ? (
          <RetinaImg
            className="search-accessory search loading"
            name="inline-loading-spinner.gif"
            mode={RetinaImg.Mode.ContentPreserve}
          />
        ) : (
          <RetinaImg
            className="search-accessory search"
            name="searchloupe.png"
            mode={RetinaImg.Mode.ContentDark}
            onClick={() => this._fieldEl.focus()}
          />
        )}
        <div className="thread-search-query-region" ref={(el) => (this._queryRegion = el)}>
          <SearchQueryEditor
            ref={this._setFieldRef}
            value={query}
            placeholder={this._placeholder()}
            onKeyDown={this._onKeyDown}
            onFocus={this._onFocus}
            onBlur={this._onBlur}
            onChange={this._onSearchQueryChanged}
            onSelectionChange={() => this._generateSuggestionsForQuery(this._fieldEl.value())}
            aria-label={this._placeholder()}
            role="searchbox"
            aria-autocomplete="list"
          />
        </div>
        {query && !isSearching && resultCount !== null ? (
          <span className="thread-search-result-count">
            {resultCount.toLocaleString()} {localized(resultCount === 1 ? 'result' : 'results')}
          </span>
        ) : null}
        {showX && (
          <RetinaImg
            name="searchclear.png"
            className="search-accessory clear"
            mode={RetinaImg.Mode.ContentDark}
            onMouseDown={this._onClearSearchQuery}
          />
        )}
        {suggestionsVisible && (
          <SearchSuggestionsPopover
            suggestions={suggestions}
            selectedIdx={selectedIdx}
            highlight={highlight}
            query={query}
            showRefinements={showRefinements}
            showTips={!query.trim() || query === this._initialQueryForPerspective()}
            onChoose={this._onChooseSuggestion}
            onForget={this._onForgetSuggestion}
            onRefine={this._onRefine}
          />
        )}
      </KeyCommandsRegion>
    );
  }
}

export default ListensToFluxStore(ThreadSearchBar, {
  stores: [SearchStore, FocusedPerspectiveStore],
  getStateFromStores() {
    return {
      query: SearchStore.query(),
      isSearching: SearchStore.isSearching(),
      resultCount: SearchStore.resultCount(),
      perspective: FocusedPerspectiveStore.current(),
    };
  },
});
