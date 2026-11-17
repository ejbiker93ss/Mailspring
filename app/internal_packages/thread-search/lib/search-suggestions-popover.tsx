import React from 'react';
import { localized } from 'summermail-exports';
import { ThreadSearchSuggestion, SuggestionSectionTitles } from './search-suggestions';
import { SearchRefinement, SearchRefinements, isRefinementActive } from './search-refinements';
import { LearnMoreURL } from './search-bar-util';

interface SearchSuggestionsPopoverProps {
  suggestions: ThreadSearchSuggestion[];
  selectedIdx: number;
  highlight: string;
  query: string;
  showRefinements: boolean;
  showTips: boolean;
  onChoose: (suggestion: ThreadSearchSuggestion) => void;
  onForget: (suggestion: ThreadSearchSuggestion) => void;
  onRefine: (refinement: SearchRefinement) => void;
}

// Keeps the popover open: every control here acts without taking focus from
// the query field.
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  const needle = highlight.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function SuggestionContent({
  suggestion,
  highlight,
}: {
  suggestion: ThreadSearchSuggestion;
  highlight: string;
}) {
  switch (suggestion.kind) {
    case 'smart':
      return (
        <span className="suggestion-smart">
          {suggestion.description && (
            <span className="suggestion-smart-text">“{suggestion.description}”</span>
          )}
          {suggestion.filters.map((f) => (
            <span className="suggestion-chip" key={`${f.token}:${f.term}`}>
              {f.label}
            </span>
          ))}
        </span>
      );
    case 'operator':
    case 'value':
      return (
        <span className="suggestion-main">
          {suggestion.token && <span className="suggestion-token">{suggestion.token}: </span>}
          {suggestion.description}
        </span>
      );
    default:
      return (
        <span className="suggestion-main">
          <span className="suggestion-title">
            <HighlightedText text={suggestion.description} highlight={highlight} />
          </span>
          {suggestion.detail && <span className="suggestion-detail">{suggestion.detail}</span>}
        </span>
      );
  }
}

export function SearchSuggestionsPopover({
  suggestions,
  selectedIdx,
  highlight,
  query,
  showRefinements,
  showTips,
  onChoose,
  onForget,
  onRefine,
}: SearchSuggestionsPopoverProps) {
  return (
    <div className="suggestions" role="listbox" onMouseDown={keepFocus}>
      {showRefinements && (
        <div className="search-refinements" role="group" aria-label={localized('Refine search')}>
          <span className="search-refinements-label">{localized('Refine')}</span>
          {SearchRefinements.map((refinement) => {
            const active = isRefinementActive(query, refinement);
            return (
              <button
                type="button"
                key={refinement.id}
                className={`search-refinement ${active ? 'active' : ''}`}
                aria-pressed={active}
                onClick={() => onRefine(refinement)}
              >
                {refinement.label}
              </button>
            );
          })}
        </div>
      )}
      {suggestions.map((s, idx) => {
        const title = s.kind !== suggestions[idx - 1]?.kind && SuggestionSectionTitles[s.kind];
        return (
          <React.Fragment key={`${s.kind}-${idx}`}>
            {title && <div className="suggestion-section">{title}</div>}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                onChoose(s);
              }}
              className={`suggestion suggestion-${s.kind} ${selectedIdx === idx ? 'selected' : ''}`}
              role="option"
              aria-selected={selectedIdx === idx}
            >
              <SuggestionContent suggestion={s} highlight={highlight} />
              {s.kind === 'recent' && (
                <button
                  type="button"
                  className="suggestion-forget"
                  aria-label={localized('Remove from recent searches')}
                  title={localized('Remove from recent searches')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onForget(s);
                  }}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              )}
              {selectedIdx === idx && s.kind === 'smart' && (
                <kbd className="suggestion-hint">{localized('Enter')}</kbd>
              )}
            </div>
          </React.Fragment>
        );
      })}
      {showTips && (
        <div className="footer">
          {localized('Tip: just type what you remember, like “invoices from Dana last month”.')}
          {LearnMoreURL && (
            <>
              {' '}
              <a
                onMouseDown={(e) => {
                  AppEnv.windowEventHandler.openLink({ href: LearnMoreURL, metaKey: e.metaKey });
                  e.preventDefault();
                }}
              >
                {localized('Learn more')} &gt;
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
