import React from 'react';
import {
  Actions,
  DatabaseStore,
  Message,
  MessageWithEditorState,
  localized,
} from 'mailspring-exports';
import { ComposerEditor } from 'mailspring-component-kit';

import { buildThreadSummaryTranscript } from '../../message-list/lib/ai-summary-client';
import { summarizeMailText } from '../../message-list/lib/openai-mail-assistant-client';
import {
  MODEL_CONFIG_KEY,
  REDACT_PERSONAL_INFO_CONFIG_KEY,
  getMailAssistantAPIKey,
} from '../../message-list/lib/preferences-mail-assistant';

export interface ComposerToneResult {
  level: 'good' | 'caution' | 'harsh';
  headline: string;
  explanation: string;
  suggestions: string[];
}

export interface ComposerDiffSegment {
  type: 'same' | 'added' | 'removed';
  text: string;
}

const GRAMMAR_PROMPT = `You edit email drafts. Correct spelling, grammar, punctuation, capitalization, and obvious typos while preserving the author's meaning, tone, paragraph breaks, and level of formality. Do not add facts, greetings, sign-offs, commentary, or markdown. Preserve every token shaped like [[PRIVATE_1]] exactly. Return only the corrected draft text.`;

const TONE_PROMPT = `You are a pragmatic workplace communication coach. Evaluate the draft using the supplied conversation context when present. Direct disagreement is not automatically rude. Warn when wording is needlessly harsh, accusatory, dismissive, threatening, sarcastic, unprofessional, or likely to inflame the exchange. Return only JSON with this exact shape: {"level":"good|caution|harsh","headline":"short verdict","explanation":"1-3 useful sentences","suggestions":["up to 3 specific improvements"]}. Do not rewrite the email and do not use markdown.`;

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export function composerTextsMatch(before: string, after: string) {
  const normalize = (value: string) => value.replace(/\r\n/g, '\n').trim();
  return normalize(before) === normalize(after);
}

function diffTokens(value: string) {
  return value.match(/\s+|[A-Za-z0-9_']+|[^A-Za-z0-9_'\s]/g) || [];
}

export function buildComposerWordDiff(before: string, after: string): ComposerDiffSegment[] {
  const left = diffTokens(before);
  const right = diffTokens(after);
  if (left.length * right.length > 2_000_000) {
    return [
      { type: 'removed', text: before },
      { type: 'added', text: after },
    ];
  }
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const raw: ComposerDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      raw.push({ type: 'same', text: left[i++] });
      j++;
    } else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) {
      raw.push({ type: 'added', text: right[j++] });
    } else {
      raw.push({ type: 'removed', text: left[i++] });
    }
  }
  return raw.reduce<ComposerDiffSegment[]>((segments, segment) => {
    const previous = segments[segments.length - 1];
    if (previous?.type === segment.type) previous.text += segment.text;
    else segments.push({ ...segment });
    return segments;
  }, []);
}

export function parseComposerToneResult(value: string): ComposerToneResult {
  const parsed = JSON.parse(stripCodeFence(value));
  const level = ['good', 'caution', 'harsh'].includes(parsed.level) ? parsed.level : 'caution';
  return {
    level,
    headline: String(parsed.headline || localized('Review the tone before sending.')),
    explanation: String(parsed.explanation || ''),
    suggestions: (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .map(String)
      .filter(Boolean)
      .slice(0, 3),
  };
}

function contactsForMessages(messages: Message[]) {
  return messages.flatMap((message) =>
    ([] as any[]).concat(message.from || [], message.to || [], message.cc || [], message.bcc || [])
  );
}

export function maskComposerPrivateText(text: string, messages: Message[]) {
  const candidates = contactsForMessages(messages).flatMap((contact) => [
    contact?.email,
    contact?.name,
  ]);
  candidates.push(
    ...((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) as string[]),
    ...((text.match(/https?:\/\/[^\s<]+/gi) || []) as string[]),
    ...((text.match(/(?:\+?\d[\d .()/-]{7,}\d)/g) || []) as string[])
  );
  const values = Array.from(
    new Set(
      candidates.map((value) => String(value || '').trim()).filter((value) => value.length > 1)
    )
  ).sort((a, b) => b.length - a.length);
  const originals = new Map<string, string>();
  let masked = text;
  values.forEach((value, index) => {
    const token = `[[PRIVATE_${index + 1}]]`;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    masked = masked.replace(new RegExp(escaped, 'gi'), token);
    originals.set(token, value);
  });
  return {
    text: masked,
    restore: (result: string) => {
      let restored = result;
      originals.forEach((value, token) => {
        restored = restored.split(token).join(value);
      });
      return restored;
    },
  };
}

async function messagesForDraft(draft: MessageWithEditorState): Promise<Message[]> {
  if (!draft.threadId) return [];
  return DatabaseStore.findAll<Message>(Message, { threadId: draft.threadId })
    .include(Message.attributes.body)
    .order(Message.attributes.date.ascending());
}

async function requestContext(draft: MessageWithEditorState, messages: Message[]) {
  if (!draft.threadId || !messages.length) return '';
  const redact = AppEnv.config.get(REDACT_PERSONAL_INFO_CONFIG_KEY) !== false;
  return buildThreadSummaryTranscript(messages, redact).slice(0, 30000);
}

interface ReviewCardProps {
  kind: 'grammar' | 'tone' | 'error';
  correctedText?: string;
  originalText?: string;
  tone?: ComposerToneResult;
  error?: string;
  onApply?: () => void;
}

export function ComposerAIReviewCard(props: ReviewCardProps) {
  const tone = props.tone;
  const grammarIsClean =
    props.kind === 'grammar' &&
    composerTextsMatch(props.originalText || '', props.correctedText || '');
  const grammarDiff =
    props.kind === 'grammar' && !grammarIsClean
      ? buildComposerWordDiff(props.originalText || '', props.correctedText || '')
      : [];
  return (
    <div className={`composer-ai-review-card ${tone ? `tone-${tone.level}` : ''}`}>
      <button
        className="composer-ai-review-close"
        aria-label={localized('Close')}
        onClick={() => Actions.closePopover()}
      >
        ×
      </button>
      {props.kind === 'grammar' && (
        <>
          <div className="composer-ai-review-kicker">{localized('AI writing check')}</div>
          <h2>{localized('Spelling & grammar')}</h2>
          {grammarIsClean ? (
            <div className="composer-ai-all-good">
              <span className="composer-ai-all-good-icon">✓</span>
              <div>
                <strong>{localized('Everything looks good')}</strong>
                <p>{localized('No spelling or grammar changes are needed.')}</p>
              </div>
            </div>
          ) : (
            <>
              <p>{localized('Here is exactly what the AI would change.')}</p>
              <div className="composer-ai-diff-legend">
                <span className="removed">{localized('Removed')}</span>
                <span className="added">{localized('Added')}</span>
              </div>
              <div className="composer-ai-corrected-preview composer-ai-change-diff">
                {grammarDiff.map((segment, index) => (
                  <span className={`diff-${segment.type}`} key={`${index}-${segment.type}`}>
                    {segment.text}
                  </span>
                ))}
              </div>
              <div className="composer-ai-review-actions">
                <button className="btn" onClick={() => Actions.closePopover()}>
                  {localized('Cancel')}
                </button>
                <button className="btn btn-emphasis" onClick={props.onApply}>
                  {localized('Apply corrections')}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {props.kind === 'tone' && tone && (
        <>
          <div className="composer-ai-review-kicker">{localized('Vibe check')}</div>
          <div className="composer-tone-verdict">
            <span className="composer-tone-icon">
              {tone.level === 'good' ? '✓' : tone.level === 'harsh' ? '!' : '•'}
            </span>
            <div>
              <h2>{tone.headline}</h2>
              <span>
                {tone.level === 'good' ? localized('Looks good') : localized('Worth a review')}
              </span>
            </div>
          </div>
          <p>{tone.explanation}</p>
          {!!tone.suggestions.length && (
            <ul>
              {tone.suggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {props.kind === 'error' && (
        <>
          <div className="composer-ai-review-kicker">{localized('AI writing tools')}</div>
          <h2>{localized('Could not complete the check')}</h2>
          <p>{props.error}</p>
          <button
            className="btn btn-emphasis"
            onClick={() => {
              Actions.closePopover();
              Actions.switchPreferencesTab('AI Assistant');
              Actions.openPreferences();
            }}
          >
            {localized('Open AI Assistant settings')}
          </button>
        </>
      )}
    </div>
  );
}

interface ComposerAIActionsProps {
  draft: MessageWithEditorState;
  editorRef: React.RefObject<ComposerEditor>;
}

export default class ComposerAIActions extends React.Component<
  ComposerAIActionsProps,
  { running: 'grammar' | 'tone' | null }
> {
  state = { running: null as 'grammar' | 'tone' | null };
  private _grammarButton = React.createRef<HTMLButtonElement>();
  private _toneButton = React.createRef<HTMLButtonElement>();

  _openCard = (card: React.ReactNode, anchor: HTMLButtonElement) => {
    Actions.openPopover(card, {
      originRect: anchor.getBoundingClientRect(),
      direction: 'down',
      fallbackDirection: 'up',
      closeOnAppBlur: false,
    });
  };

  _run = async (kind: 'grammar' | 'tone') => {
    const editor = this.props.editorRef.current;
    const anchor = kind === 'grammar' ? this._grammarButton.current : this._toneButton.current;
    const text = editor?.getEditableText();
    if (!anchor || !editor || !text) return;
    this.setState({ running: kind });
    try {
      const apiKey = await getMailAssistantAPIKey();
      if (!apiKey) throw new Error(localized('Add your OpenAI API key to use writing checks.'));
      const messages = await messagesForDraft(this.props.draft);
      const context = await requestContext(this.props.draft, messages);
      const model = AppEnv.config.get(MODEL_CONFIG_KEY) || 'gpt-5.6-terra';
      if (kind === 'grammar') {
        const redact = AppEnv.config.get(REDACT_PERSONAL_INFO_CONFIG_KEY) !== false;
        const masked = redact
          ? maskComposerPrivateText(text, [...messages, this.props.draft as Message])
          : { text, restore: (value: string) => value };
        const result = await summarizeMailText({
          apiKey,
          model,
          systemPrompt: GRAMMAR_PROMPT,
          userMessage: `${context ? `Conversation context:\n${context}\n\n` : ''}Draft:\n${masked.text}`,
        });
        const correctedText = masked.restore(stripCodeFence(result));
        this._openCard(
          <ComposerAIReviewCard
            kind="grammar"
            originalText={text}
            correctedText={correctedText}
            onApply={() => {
              editor.replaceEditableText(correctedText);
              Actions.closePopover();
            }}
          />,
          anchor
        );
      } else {
        const redact = AppEnv.config.get(REDACT_PERSONAL_INFO_CONFIG_KEY) !== false;
        const masked = redact
          ? maskComposerPrivateText(text, [...messages, this.props.draft as Message]).text
          : text;
        const result = await summarizeMailText({
          apiKey,
          model,
          systemPrompt: TONE_PROMPT,
          userMessage: `${context ? `Conversation context:\n${context}\n\n` : ''}Draft to evaluate:\n${masked}`,
        });
        this._openCard(
          <ComposerAIReviewCard kind="tone" tone={parseComposerToneResult(result)} />,
          anchor
        );
      }
    } catch (error) {
      this._openCard(
        <ComposerAIReviewCard kind="error" error={error.message || String(error)} />,
        anchor
      );
    } finally {
      this.setState({ running: null });
    }
  };

  render() {
    return (
      <div className="composer-ai-toolbar-actions">
        <button
          ref={this._grammarButton}
          type="button"
          disabled={!!this.state.running}
          title={localized('Fix spelling and grammar with AI')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => this._run('grammar')}
        >
          <span className="composer-ai-toolbar-icon">✓</span>
          <span>
            {this.state.running === 'grammar' ? localized('Checking…') : localized('Fix')}
          </span>
        </button>
        <button
          ref={this._toneButton}
          type="button"
          disabled={!!this.state.running}
          title={localized('Check whether this email sounds too harsh')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => this._run('tone')}
        >
          <span className="composer-ai-toolbar-icon">◇</span>
          <span>{this.state.running === 'tone' ? localized('Checking…') : localized('Vibe')}</span>
        </button>
      </div>
    );
  }
}
