import React from 'react';
import { Actions, AutomationActionRegistry, localized, Utils } from 'summermail-exports';
import AutomationStore from './automation-store';
import { Automation, AutomationStep } from './automation-types';

const { dialog } = require('@electron/remote');

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function riskDescription(automation: Automation) {
  return automation.steps
    .map((step) => AutomationActionRegistry.action(step.type))
    .filter(Boolean)
    .filter((action) => action.risk !== 'none')
    .map((action) => action.label)
    .join(', ');
}

export default class PreferencesAutomations extends React.Component<
  Record<string, never>,
  { automations: Automation[]; selectedId?: string; draft?: Automation; revision: number }
> {
  static displayName = 'PreferencesAutomations';
  private unlisten?: () => void;
  private actionUnlisten?: any;

  constructor(props) {
    super(props);
    const automations = AutomationStore.automations();
    this.state = {
      automations,
      selectedId: automations[0]?.id,
      draft: automations[0] ? clone(automations[0]) : undefined,
      revision: 0,
    };
  }

  componentDidMount() {
    this.unlisten = AutomationStore.listen(this._refresh);
    this.actionUnlisten = AutomationActionRegistry.onDidChange(this._refresh);
  }

  componentWillUnmount() {
    this.unlisten?.();
    this.actionUnlisten?.dispose?.();
  }

  private _refresh = () => {
    const automations = AutomationStore.automations();
    const selectedId = automations.some((item) => item.id === this.state.selectedId)
      ? this.state.selectedId
      : automations[0]?.id;
    const selected = automations.find((item) => item.id === selectedId);
    this.setState({
      automations,
      selectedId,
      draft: selected ? clone(selected) : undefined,
      revision: this.state.revision + 1,
    });
  };

  private _select = (id: string) => {
    const item = AutomationStore.automation(id);
    this.setState({ selectedId: id, draft: item ? clone(item) : undefined });
  };

  private _patch = (patch: Partial<Automation>) =>
    this.setState((state) => ({ draft: { ...state.draft, ...patch } }));

  private _add = () => {
    Actions.createAutomation();
    setTimeout(() => {
      const item = AutomationStore.automations().slice(-1)[0];
      if (item) this._select(item.id);
    }, 0);
  };

  private _addStep = (type: string) => {
    const action = AutomationActionRegistry.action(type);
    if (!action || !this.state.draft) return;
    const step: AutomationStep = {
      id: Utils.generateTempId(),
      type,
      actionVersion: action.version,
      config: action.createDefaultConfig(),
    };
    this._patch({ steps: [...this.state.draft.steps, step] });
  };

  private _patchStep = (index: number, patch: Partial<AutomationStep>) => {
    if (!this.state.draft) return;
    const steps = this.state.draft.steps.map((step, stepIndex) =>
      stepIndex === index ? { ...step, ...patch } : step
    );
    this._patch({ steps });
  };

  private _moveStep = (index: number, direction: number) => {
    if (!this.state.draft) return;
    const next = index + direction;
    if (next < 0 || next >= this.state.draft.steps.length) return;
    const steps = [...this.state.draft.steps];
    [steps[index], steps[next]] = [steps[next], steps[index]];
    this._patch({ steps });
  };

  private _save = async () => {
    const draft = this.state.draft;
    if (!draft) return;
    const issues = AutomationStore.issues({ ...draft, enabled: false });
    if (issues.length) {
      AppEnv.showErrorDialog({ title: localized('Fix this automation'), message: issues[0] });
      return;
    }
    const conflicts = AutomationStore.shortcutConflict(draft.shortcut, draft.id);
    if (conflicts.length) {
      AppEnv.showErrorDialog({
        title: localized('Shortcut already in use'),
        message: `This shortcut is assigned to ${conflicts[0]}. Choose another one.`,
      });
      return;
    }
    const hasRisk = AutomationStore.risks(draft).length > 0;
    let next = { ...draft };
    if (hasRisk && next.acknowledgedRiskHash !== AutomationStore.riskHash(next)) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: localized('Review automation'),
        message: localized('This automation will run without asking again.'),
        detail: `${riskDescription(next)} will run on the selected conversations in the order shown. Sending and printing cannot be undone.`,
        checkboxLabel: localized('I understand'),
        buttons: [localized('Cancel'), localized('Save and enable')],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1 || !result.checkboxChecked) return;
      next = AutomationStore.acknowledge(next);
    }
    Actions.updateAutomation(next.id, next);
  };

  private _captureShortcut = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!this.state.draft) return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      this._patch({ shortcut: '' });
      return;
    }
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    event.preventDefault();
    const modifiers = [
      event.ctrlKey || event.metaKey ? 'mod' : '',
      event.altKey ? 'alt' : '',
      event.shiftKey ? 'shift' : '',
    ].filter(Boolean);
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
    this._patch({ shortcut: [...modifiers, key].join('+') });
  };

  private _renderStep(step: AutomationStep, index: number) {
    const action = AutomationActionRegistry.action(step.type);
    if (!action)
      return (
        <div className="automation-step invalid" key={step.id}>
          Unavailable action: {step.type}
        </div>
      );
    const issues = action.validate(step.config);
    return (
      <div className="automation-step" key={step.id}>
        <div className="automation-step-heading">
          <strong>
            {index + 1}. {action.label}
          </strong>
          <span>{action.summarize(step.config)}</span>
          <div className="automation-step-buttons">
            <button
              className="btn btn-small"
              aria-label="Move step up"
              disabled={index === 0}
              onClick={() => this._moveStep(index, -1)}
            >
              Move up
            </button>
            <button
              className="btn btn-small"
              aria-label="Move step down"
              disabled={index === this.state.draft.steps.length - 1}
              onClick={() => this._moveStep(index, 1)}
            >
              Move down
            </button>
            <button
              className="btn btn-small"
              onClick={() =>
                this._patch({
                  steps: this.state.draft.steps.filter((_, itemIndex) => itemIndex !== index),
                })
              }
            >
              Remove
            </button>
          </div>
        </div>
        <div className="automation-step-editor">
          {action.renderEditor?.({
            config: step.config,
            onChange: (config) => this._patchStep(index, { config }),
          })}
        </div>
        {issues.map((issue) => (
          <div className="automation-error" key={issue}>
            {issue}
          </div>
        ))}
      </div>
    );
  }

  render() {
    const { automations, draft } = this.state;
    return (
      <div className="container-automations">
        <aside className="automation-list">
          <div className="automation-list-heading">
            <h2>{localized('Automations')}</h2>
            <button className="btn btn-small btn-emphasis" onClick={this._add}>
              Create
            </button>
          </div>
          {automations.length ? (
            automations.map((item) => (
              <button
                key={item.id}
                className={`automation-list-item ${item.id === draft?.id ? 'selected' : ''}`}
                onClick={() => this._select(item.id)}
              >
                <strong>{item.name}</strong>
                <span>{item.shortcut || localized('No shortcut')}</span>
              </button>
            ))
          ) : (
            <p className="automation-empty">Create a workflow for the conversations you select.</p>
          )}
        </aside>
        <section className="automation-editor">
          {draft ? (
            <>
              <div className="automation-editor-heading">
                <div>
                  {this._field('Name', draft.name, (name) => this._patch({ name }))}
                  {this._field('Shortcut', draft.shortcut, () => {}, {
                    onKeyDown: this._captureShortcut,
                    placeholder: 'Click and press keys',
                  })}
                </div>
                <label className="automation-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => this._patch({ enabled: event.target.checked })}
                  />{' '}
                  Enabled
                </label>
              </div>
              <label className="automation-field">
                <span>Description</span>
                <input
                  value={draft.description || ''}
                  onChange={(event) => this._patch({ description: event.target.value })}
                />
              </label>
              <h2>Steps</h2>
              <div className="automation-steps">
                {draft.steps.map((step, index) => this._renderStep(step, index))}
              </div>
              <label className="automation-field">
                <span>Add step</span>
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) this._addStep(event.target.value);
                  }}
                >
                  <option value="">Choose an action…</option>
                  {AutomationActionRegistry.actions().map((action) => (
                    <option key={action.type} value={action.type}>
                      {action.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="automation-footer">
                <button className="btn" onClick={() => Actions.duplicateAutomation(draft.id)}>
                  Duplicate
                </button>
                <button className="btn" onClick={() => Actions.deleteAutomation(draft.id)}>
                  Delete
                </button>
                <span />
                <button className="btn btn-emphasis" onClick={this._save}>
                  Save automation
                </button>
              </div>
            </>
          ) : (
            <div className="automation-empty">
              <h2>No automation selected</h2>
              <p>Create an automation to combine mail actions into one repeatable flow.</p>
            </div>
          )}
        </section>
      </div>
    );
  }

  private _field(label: string, value: string, onChange: (value: string) => void, extra: any = {}) {
    return (
      <label className="automation-field">
        <span>{label}</span>
        <input value={value || ''} onChange={(event) => onChange(event.target.value)} {...extra} />
      </label>
    );
  }
}
