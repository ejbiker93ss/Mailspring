import crypto from 'crypto';
import SummerMailStore from 'summermail-store';
import { Actions, AutomationActionRegistry, Utils } from 'summermail-exports';
import AutomationStorage from './automation-storage';
import { Automation, AutomationStep } from './automation-types';

const sourceId = 'automations';

function now() {
  return new Date().toISOString();
}

function stableRiskShape(automation: Automation) {
  return automation.steps.map((step) => {
    const descriptor = AutomationActionRegistry.action(step.type);
    return { type: step.type, risk: descriptor?.risk || 'destructive', config: step.config };
  });
}

class AutomationStore extends SummerMailStore {
  private storage = new AutomationStorage();
  private _automations: Automation[] = [];
  private _runtimeDisposable: any;

  constructor() {
    super();
    this._automations = this.storage.load();
    this.listenTo(Actions.createAutomation, this._onCreate);
    this.listenTo(Actions.updateAutomation, this._onUpdate);
    this.listenTo(Actions.deleteAutomation, this._onDelete);
    this.listenTo(Actions.duplicateAutomation, this._onDuplicate);
    AutomationActionRegistry.onDidChange(this._onActionRegistryChanged);
    this._refreshRuntimeBindings();
  }

  automations() {
    return this._automations.slice();
  }

  automation(id: string) {
    return this._automations.find((item) => item.id === id);
  }

  riskHash(automation: Automation) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(stableRiskShape(automation)))
      .digest('hex');
  }

  risks(automation: Automation) {
    return automation.steps
      .map((step) => AutomationActionRegistry.action(step.type))
      .filter(Boolean)
      .filter((action) => action.risk !== 'none');
  }

  issues(automation: Automation) {
    const issues: string[] = [];
    if (!automation.name.trim()) issues.push('Give this automation a name.');
    if (!automation.steps.length) issues.push('Add at least one step.');
    automation.steps.forEach((step, index) => {
      const action = AutomationActionRegistry.action(step.type);
      if (!action) {
        issues.push(`Step ${index + 1} uses an unavailable action.`);
        return;
      }
      for (const issue of action.validate(step.config)) issues.push(`Step ${index + 1}: ${issue}`);
    });
    if (
      automation.enabled &&
      this.risks(automation).length &&
      automation.acknowledgedRiskHash !== this.riskHash(automation)
    ) {
      issues.push('Review the automation warning before enabling this workflow.');
    }
    return issues;
  }

  canRun(automation: Automation) {
    return (
      !!automation?.enabled &&
      this.issues(automation).length === 0 &&
      (!automation.shortcut ||
        this.shortcutConflict(automation.shortcut, automation.id).length === 0)
    );
  }

  shortcutConflict(shortcut: string, exceptAutomationId?: string) {
    if (!shortcut) return [];
    const keymapConflicts = AppEnv.keymaps
      .getCommandsForKeystrokes(shortcut)
      .filter((command) => command !== `automation:run:${exceptAutomationId}`);
    const automationConflicts = this._automations
      .filter(
        (automation) =>
          automation.id !== exceptAutomationId &&
          automation.enabled &&
          automation.shortcut?.toLowerCase() === shortcut.toLowerCase()
      )
      .map((automation) => `automation:run:${automation.id}`);
    return Array.from(new Set([...keymapConflicts, ...automationConflicts]));
  }

  acknowledge(automation: Automation) {
    return { ...automation, acknowledgedRiskHash: this.riskHash(automation) };
  }

  private _onCreate = () => {
    const item: Automation = {
      id: Utils.generateTempId(),
      name: 'Untitled automation',
      description: '',
      enabled: false,
      shortcut: '',
      failurePolicy: 'stop',
      createdAt: now(),
      updatedAt: now(),
      steps: [],
    };
    this._automations = [...this._automations, item];
    this._persist();
  };

  private _onUpdate = (id: string, patch: Partial<Automation>) => {
    this._automations = this._automations.map((item) =>
      item.id === id ? { ...item, ...patch, updatedAt: now() } : item
    );
    this._persist();
  };

  private _onDelete = (id: string) => {
    this._automations = this._automations.filter((item) => item.id !== id);
    this._persist();
  };

  private _onDuplicate = (id: string) => {
    const source = this.automation(id);
    if (!source) return;
    const copy: Automation = JSON.parse(JSON.stringify(source));
    copy.id = Utils.generateTempId();
    copy.name = `${source.name} copy`;
    copy.shortcut = '';
    copy.enabled = false;
    copy.createdAt = now();
    copy.updatedAt = now();
    copy.steps.forEach((step: AutomationStep) => (step.id = Utils.generateTempId()));
    this._automations = [...this._automations, copy];
    this._persist();
  };

  private _onActionRegistryChanged = () => {
    this._refreshRuntimeBindings();
    this.trigger();
  };

  private _persist() {
    try {
      this.storage.save(this._automations);
      this._refreshRuntimeBindings();
      this.trigger();
    } catch (error) {
      AppEnv.showErrorDialog({ title: 'Could not save automations', message: error.message });
    }
  }

  private _refreshRuntimeBindings() {
    if (this._runtimeDisposable) this._runtimeDisposable.dispose();
    const bindings = {};
    for (const automation of this._automations) {
      if (this.canRun(automation) && automation.shortcut) {
        bindings[`automation:run:${automation.id}`] = automation.shortcut;
      }
    }
    this._runtimeDisposable = AppEnv.keymaps.setRuntimeBindings(sourceId, bindings);
  }
}

export default new AutomationStore();
