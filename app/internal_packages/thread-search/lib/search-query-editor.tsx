import React, { Component } from 'react';
import { localized } from 'summermail-exports';
import { TokenSuggestions, wrapInQuotes } from './search-bar-util';
import {
  SearchQueryPart,
  searchQueryParts,
  replaceSearchQueryPart,
  removeSearchQueryPart,
} from './search-query-parts';

interface SearchQueryEditorProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  onBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  onSelectionChange?: () => void;
  'aria-label'?: string;
  role?: string;
  'aria-autocomplete'?: string;
}

export default class SearchQueryEditor extends Component<
  SearchQueryEditorProps,
  { value: string }
> {
  private editor: HTMLDivElement;
  private cursor = -1;
  private restoreFocus = false;

  constructor(props: SearchQueryEditorProps) {
    super(props);
    this.state = { value: props.value };
  }

  componentDidUpdate(prevProps: SearchQueryEditorProps) {
    if (prevProps.value !== this.props.value && this.props.value !== this.state.value) {
      this.restoreFocus = this.editor.contains(document.activeElement);
      this.setState({ value: this.props.value });
      return;
    }
    if (this.restoreFocus) {
      this.restoreFocus = false;
      this.focus();
    }
  }

  focus = () => {
    const inputs = Array.from(this.editor.querySelectorAll<HTMLInputElement>('input'));
    const input =
      inputs.find((el) => el.dataset.filter === 'true' && !el.value) || inputs[inputs.length - 1];
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    this._rememberCursor();
  };

  focusEnd = () => {
    const input = this.editor.querySelector<HTMLInputElement>('.search-query-text:last-child');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    this._rememberCursor();
  };

  isAppending = () => {
    const input = this.editor.querySelector<HTMLInputElement>('.search-query-text:last-child');
    return input === document.activeElement && !input.value.trim();
  };

  blur = () => {
    if (this.editor.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
  };

  value = () => this.state.value;

  insertionIndex = () => this.cursor;

  resetScrollPosition = () => {
    this.editor.scrollTop = 0;
    this.editor.scrollLeft = 0;
  };

  private _rememberCursor = () => {
    const input = document.activeElement as HTMLInputElement;
    if (!this.editor.contains(input) || input.tagName !== 'INPUT') return;
    this.cursor = Number(input.dataset.start) + (input.selectionStart || 0);
    this.props.onSelectionChange?.();
  };

  private _replace = (part: SearchQueryPart, text: string, cursor: number, focusValue = false) => {
    // A pill's trailing editor starts empty, but the query parser still needs
    // whitespace between the existing filter and the next typed term.
    if (!part.token && !part.text.trim() && part.start > 0 && text && !/^\s/.test(text)) {
      text = ` ${text}`;
      cursor++;
    }
    const value = replaceSearchQueryPart(this.state.value, part, text);
    this.cursor = cursor;
    const convertsToPill = !part.token && searchQueryParts(text).some((p) => p.token);
    this.setState({ value }, () => {
      if (convertsToPill) this.focus();
      if (focusValue) {
        this.editor
          .querySelector<HTMLInputElement>(`input[data-part-start="${part.start}"]`)
          ?.focus();
        this._rememberCursor();
      }
      this.props.onChange(value);
    });
  };

  private _remove = (part: SearchQueryPart) => {
    const value = removeSearchQueryPart(this.state.value, part);
    this.setState({ value }, () => {
      this.focus();
      this.props.onChange(value);
    });
  };

  private _input = (part: SearchQueryPart, index: number) => {
    const appendInput = !part.token && part.end === this.state.value.length;
    const value = part.token ? part.term : appendInput && !part.text.trim() ? '' : part.text;
    const quoted = part.token && part.text.includes('"');
    const start = part.start + (part.token ? part.text.indexOf(':') + 1 + (quoted ? 1 : 0) : 0);
    return (
      <input
        key={index}
        className={part.token ? 'search-filter-value' : 'search-query-text'}
        value={value}
        placeholder={
          !this.state.value
            ? this.props.placeholder
            : appendInput
              ? localized('Add filter…')
              : undefined
        }
        role={!part.token && part.end === this.state.value.length ? this.props.role : undefined}
        aria-label={
          part.token ? localized('%@ filter value', part.token) : this.props['aria-label']
        }
        aria-autocomplete={
          this.props['aria-autocomplete'] as React.AriaAttributes['aria-autocomplete']
        }
        data-start={start}
        data-part-start={part.start}
        data-filter={!!part.token}
        onFocus={this._rememberCursor}
        onClick={this._rememberCursor}
        onKeyUp={this._rememberCursor}
        onKeyDown={(event) => {
          if (part.token && !value && event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            this._remove(part);
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          const encoded = part.token && /\s/.test(next) ? wrapInQuotes(next) : next;
          const text = part.token ? `${part.token}:${encoded}` : next;
          this._replace(
            part,
            text,
            part.start +
              (part.token ? part.token.length + 1 : 0) +
              (encoded.startsWith('"') ? 1 : 0) +
              (event.target.selectionStart || 0)
          );
        }}
      />
    );
  };

  render() {
    return (
      <div
        className="search-query-editor"
        ref={(el) => (this.editor = el)}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).tagName === 'INPUT') this.props.onKeyDown(event);
        }}
        onFocus={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) this.props.onFocus(event);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) this.props.onBlur(event);
        }}
      >
        {searchQueryParts(this.state.value).map((part, index) =>
          part.token ? (
            <span className="search-filter-pill" key={index}>
              <select
                aria-label={localized('Search filter type')}
                value={part.token}
                onChange={(event) => {
                  const token = event.target.value;
                  this._replace(
                    part,
                    token + part.text.slice(part.text.indexOf(':')),
                    part.start + token.length + 1,
                    true
                  );
                }}
              >
                {TokenSuggestions.map(({ token }) => (
                  <option key={token} value={token}>
                    {token}
                  </option>
                ))}
              </select>
              {this._input(part, index)}
              <button
                type="button"
                className="search-filter-remove"
                aria-label={localized('Remove %@ filter', part.token)}
                onClick={() => this._remove(part)}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="m3 3 6 6m0-6-6 6" />
                </svg>
              </button>
            </span>
          ) : (
            this._input(part, index)
          )
        )}
      </div>
    );
  }
}
