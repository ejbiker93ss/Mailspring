import { Emitter, Disposable } from 'event-kit';

/**
 * A small public registry for actions that can be composed into a mail
 * automation. Keeping this in core lets built-in and third-party packages add
 * actions without teaching the automation UI about every feature.
 */
export type AutomationRisk = 'none' | 'side-effect' | 'destructive';

export interface AutomationActionDescriptor<TConfig = any> {
  type: string;
  version: number;
  label: string;
  description: string;
  category: 'mail' | 'organization' | 'printing' | 'other';
  risk: AutomationRisk;
  createDefaultConfig: () => TConfig;
  summarize: (config: TConfig) => string;
  validate: (config: TConfig) => string[];
  renderEditor?: (props: any) => any;
  execute: (context: any, config: TConfig) => Promise<void>;
}

class AutomationActionRegistry {
  private _actions = new Map<string, AutomationActionDescriptor>();
  private _emitter = new Emitter();

  register<TConfig>(descriptor: AutomationActionDescriptor<TConfig>) {
    if (!descriptor?.type || !descriptor.execute || !descriptor.createDefaultConfig) {
      throw new Error('Automation actions require a type, executor, and default configuration.');
    }
    if (this._actions.has(descriptor.type)) {
      throw new Error(`An automation action named ${descriptor.type} is already registered.`);
    }
    this._actions.set(descriptor.type, descriptor as AutomationActionDescriptor);
    this._emitter.emit('changed');
    return new Disposable(() => {
      if (this._actions.get(descriptor.type) === descriptor) {
        this._actions.delete(descriptor.type);
        this._emitter.emit('changed');
      }
    });
  }

  action(type: string) {
    return this._actions.get(type);
  }

  actions() {
    return Array.from(this._actions.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  onDidChange(callback: () => void) {
    return this._emitter.on('changed', callback);
  }
}

export default new AutomationActionRegistry();
