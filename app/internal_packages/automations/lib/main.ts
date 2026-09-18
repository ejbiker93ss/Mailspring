import { ComponentRegistry, PreferencesUIStore, localized } from 'summermail-exports';
import registerBuiltInActions from './actions/register-built-in-actions';
import AutomationToolbarButton from './automation-toolbar-button';
import './automation-runner';

let actionDisposables = [];
let preferencesTab: any;

export function activate() {
  actionDisposables = registerBuiltInActions();
  preferencesTab = new PreferencesUIStore.TabItem({
    tabId: 'Automations',
    displayName: localized('Automations'),
    componentClassFn: () => require('./preferences-automations').default,
    order: 5.5,
  });
  PreferencesUIStore.registerPreferencesTab(preferencesTab);
  ComponentRegistry.register(AutomationToolbarButton, { role: 'ThreadActionsToolbarButton' });
}

export function deactivate() {
  ComponentRegistry.unregister(AutomationToolbarButton);
  PreferencesUIStore.unregisterPreferencesTab(preferencesTab?.tabId);
  actionDisposables.forEach((disposable) => disposable.dispose());
  actionDisposables = [];
}
