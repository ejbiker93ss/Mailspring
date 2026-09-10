import React, { useMemo, useState } from 'react';
import { AccountStore, Actions, MailboxPerspective, localized } from 'summermail-exports';
import SearchMailboxPerspective from '../../../thread-search/lib/search-mailbox-perspective';
import {
  SmartFolderCriterion,
  SmartFolderCriterionField,
  SmartFolderDefinition,
  createSmartFolderCriterion,
  createSmartFolderDefinition,
  saveSmartFolder,
  smartFolderQuery,
} from '../smart-folders';

const FIELD_OPTIONS: Array<{ value: SmartFolderCriterionField; label: string }> = [
  { value: 'anywhere', label: 'Anywhere' },
  { value: 'subject', label: 'Subject' },
  { value: 'from', label: 'From' },
  { value: 'to', label: 'To or Cc' },
  { value: 'body', label: 'Message body' },
  { value: 'folder', label: 'Folder or label' },
  { value: 'before', label: 'Received before' },
  { value: 'after', label: 'Received after' },
  { value: 'state', label: 'Message state' },
  { value: 'attachment', label: 'Has an attachment' },
];

const placeholderForField = (field: SmartFolderCriterionField) => {
  switch (field) {
    case 'from':
    case 'to':
      return localized('name or email address');
    case 'folder':
      return localized('folder or label name');
    case 'before':
    case 'after':
      return localized('date or phrase, e.g. last month');
    case 'body':
      return localized('words in the message body');
    case 'anywhere':
      return localized('words anywhere in the message');
    default:
      return localized('words to match');
  }
};

const cloneDefinition = (definition?: SmartFolderDefinition): SmartFolderDefinition => {
  const source = definition || createSmartFolderDefinition();
  return {
    ...source,
    accountIds: [...source.accountIds],
    criteria: source.criteria.map((criterion) => ({ ...criterion })),
  };
};

const SmartFolderGlyph = () => (
  <svg aria-hidden="true" className="smart-folder-editor-glyph" viewBox="0 0 24 24">
    <path d="M3.5 7.5h6l2-2h9v13h-17z" />
    <path d="m14.5 10 .8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />
  </svg>
);

const RemoveGlyph = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16">
    <path d="M3.5 3.5 12.5 12.5M12.5 3.5l-9 9" />
  </svg>
);

const AddGlyph = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const SmartFolderEditor = ({ definition }: { definition?: SmartFolderDefinition }) => {
  const accounts = AccountStore.accounts();
  const [draft, setDraft] = useState(() => cloneDefinition(definition));
  const [showErrors, setShowErrors] = useState(false);
  const query = useMemo(() => smartFolderQuery(draft), [draft]);
  const selectedScopeIsValid = draft.scope === 'all' || draft.accountIds.length > 0;
  const criteriaAreValid = draft.criteria.every(
    (criterion) => criterion.field === 'attachment' || criterion.value.trim().length > 0
  );
  const valid = draft.name.trim().length > 0 && selectedScopeIsValid && criteriaAreValid && !!query;

  const updateCriterion = (criterionId: string, changes: Partial<SmartFolderCriterion>) => {
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.map((criterion) =>
        criterion.id === criterionId ? { ...criterion, ...changes } : criterion
      ),
    }));
  };

  const updateCriterionField = (
    criterion: SmartFolderCriterion,
    field: SmartFolderCriterionField
  ) => {
    updateCriterion(criterion.id, {
      field,
      value: field === 'state' ? 'unread' : '',
    });
  };

  const toggleAccount = (accountId: string) => {
    setDraft((current) => ({
      ...current,
      accountIds: current.accountIds.includes(accountId)
        ? current.accountIds.filter((id) => id !== accountId)
        : [...current.accountIds, accountId],
    }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (!valid) return;
    const saved = { ...draft, name: draft.name.trim() };
    saveSmartFolder(saved);
    const availableIds = new Set(accounts.map((account) => account.id));
    const accountIds =
      saved.scope === 'all'
        ? accounts.map((account) => account.id)
        : saved.accountIds.filter((accountId) => availableIds.has(accountId));
    Actions.focusMailboxPerspective(
      new SearchMailboxPerspective(new MailboxPerspective(accountIds), query, {
        name: saved.name,
        iconName: 'searchloupe.png',
        smartFolderId: saved.id,
      })
    );
    Actions.closeModal();
  };

  return (
    <form className="smart-folder-editor" onSubmit={submit}>
      <header className="smart-folder-editor-header">
        <div className="smart-folder-editor-icon">
          <SmartFolderGlyph />
        </div>
        <div>
          <h2>{definition ? localized('Edit Smart Folder') : localized('New Smart Folder')}</h2>
          <p>{localized('Create a live view that updates whenever a message matches.')}</p>
        </div>
      </header>

      <div className="smart-folder-editor-scroll">
        <label className="smart-folder-editor-field smart-folder-editor-name">
          <span>{localized('Name')}</span>
          <input
            autoFocus
            type="text"
            value={draft.name}
            className={showErrors && !draft.name.trim() ? 'invalid' : ''}
            placeholder={localized('e.g. Invoices to review')}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>

        <fieldset className="smart-folder-editor-scope">
          <legend>{localized('Search in')}</legend>
          <label className={draft.scope === 'all' ? 'selected' : ''}>
            <input
              type="radio"
              name="smart-folder-scope"
              checked={draft.scope === 'all'}
              onChange={() => setDraft({ ...draft, scope: 'all' })}
            />
            <span>
              <strong>{localized('All accounts')}</strong>
              <small>{localized('Includes accounts you add later')}</small>
            </span>
          </label>
          <label className={draft.scope === 'selected' ? 'selected' : ''}>
            <input
              type="radio"
              name="smart-folder-scope"
              checked={draft.scope === 'selected'}
              onChange={() => setDraft({ ...draft, scope: 'selected' })}
            />
            <span>
              <strong>{localized('Selected accounts')}</strong>
              <small>{localized('Choose one or more accounts')}</small>
            </span>
          </label>
          {draft.scope === 'selected' ? (
            <div className="smart-folder-editor-accounts">
              {accounts.map((account) => (
                <label key={account.id}>
                  <input
                    type="checkbox"
                    checked={draft.accountIds.includes(account.id)}
                    onChange={() => toggleAccount(account.id)}
                  />
                  <span className="account-color" style={{ backgroundColor: account.color }} />
                  <span>{account.label}</span>
                </label>
              ))}
              {showErrors && !selectedScopeIsValid ? (
                <div className="smart-folder-editor-error">
                  {localized('Choose at least one account.')}
                </div>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <section
          className="smart-folder-editor-criteria"
          aria-labelledby="smart-folder-rules-title"
        >
          <div className="smart-folder-editor-criteria-heading">
            <div>
              <h3 id="smart-folder-rules-title">{localized('Criteria')}</h3>
              <p>{localized('Messages appear when they match the rules below.')}</p>
            </div>
            <label>
              <span>{localized('Match')}</span>
              <select
                value={draft.match}
                onChange={(event) =>
                  setDraft({ ...draft, match: event.target.value === 'any' ? 'any' : 'all' })
                }
              >
                <option value="all">{localized('all criteria')}</option>
                <option value="any">{localized('any criterion')}</option>
              </select>
            </label>
          </div>

          <div className="smart-folder-editor-rules">
            {draft.criteria.map((criterion, index) => (
              <div className="smart-folder-editor-rule" key={criterion.id}>
                <span className="rule-index" aria-hidden="true">
                  {index + 1}
                </span>
                <select
                  aria-label={localized('Criterion field')}
                  value={criterion.field}
                  onChange={(event) =>
                    updateCriterionField(criterion, event.target.value as SmartFolderCriterionField)
                  }
                >
                  {FIELD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {localized(option.label)}
                    </option>
                  ))}
                </select>
                {criterion.field === 'state' ? (
                  <select
                    aria-label={localized('Message state')}
                    value={criterion.value}
                    onChange={(event) =>
                      updateCriterion(criterion.id, { value: event.target.value })
                    }
                  >
                    <option value="unread">{localized('is unread')}</option>
                    <option value="read">{localized('is read')}</option>
                    <option value="starred">{localized('is starred')}</option>
                    <option value="unstarred">{localized('is not starred')}</option>
                  </select>
                ) : criterion.field === 'attachment' ? (
                  <div className="smart-folder-editor-rule-static">
                    {localized('Attachment required')}
                  </div>
                ) : (
                  <input
                    type="text"
                    aria-label={localized('Criterion value')}
                    value={criterion.value}
                    className={showErrors && !criterion.value.trim() ? 'invalid' : ''}
                    placeholder={placeholderForField(criterion.field)}
                    onChange={(event) =>
                      updateCriterion(criterion.id, { value: event.target.value })
                    }
                  />
                )}
                <button
                  type="button"
                  className="smart-folder-editor-remove"
                  aria-label={localized('Remove criterion')}
                  disabled={draft.criteria.length === 1}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      criteria: draft.criteria.filter((item) => item.id !== criterion.id),
                    })
                  }
                >
                  <RemoveGlyph />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="smart-folder-editor-add"
            onClick={() =>
              setDraft({
                ...draft,
                criteria: [...draft.criteria, createSmartFolderCriterion('anywhere')],
              })
            }
          >
            <AddGlyph />
            {localized('Add criterion')}
          </button>
        </section>
      </div>

      <footer className="smart-folder-editor-footer">
        <label className="smart-folder-editor-favorite">
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })}
          />
          <span>{localized('Show in Favorites')}</span>
        </label>
        <div className="smart-folder-editor-footer-actions">
          <button type="button" className="btn" onClick={() => Actions.closeModal()}>
            {localized('Cancel')}
          </button>
          <button type="submit" className="btn btn-emphasis">
            {definition ? localized('Save Changes') : localized('Create Smart Folder')}
          </button>
        </div>
      </footer>
    </form>
  );
};

export const openSmartFolderEditor = (definition?: SmartFolderDefinition) => {
  Actions.openModal({
    component: <SmartFolderEditor definition={definition} />,
    width: 680,
    height: 650,
  });
};

export default SmartFolderEditor;
