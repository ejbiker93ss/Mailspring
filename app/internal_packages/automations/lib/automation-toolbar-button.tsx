import React from 'react';
import { BindGlobalCommands } from 'summermail-component-kit';
import { localized, Thread } from 'summermail-exports';
import AutomationStore from './automation-store';
import AutomationRunner from './automation-runner';

const { Menu, MenuItem, getCurrentWindow } = require('@electron/remote');

export default class AutomationToolbarButton extends React.Component<
  { items: Thread[] },
  { revision: number }
> {
  static displayName = 'AutomationToolbarButton';
  static containerRequired = false;
  private unlisten?: () => void;

  state = { revision: 0 };

  componentDidMount() {
    this.unlisten = AutomationStore.listen(() =>
      this.setState((state) => ({ revision: state.revision + 1 }))
    );
  }

  componentWillUnmount() {
    this.unlisten?.();
  }

  private _commands() {
    const commands = {};
    for (const automation of AutomationStore.automations()) {
      if (AutomationStore.canRun(automation)) {
        commands[`automation:run:${automation.id}`] = () => AutomationRunner.run(automation.id);
      }
    }
    return commands;
  }

  private _openMenu = () => {
    const menu = new Menu();
    const available = AutomationStore.automations().filter((automation) =>
      AutomationStore.canRun(automation)
    );
    if (!available.length) {
      menu.append(new MenuItem({ label: localized('No enabled automations'), enabled: false }));
    }
    for (const automation of available) {
      menu.append(
        new MenuItem({
          label: automation.name,
          accelerator: automation.shortcut || undefined,
          click: () => AutomationRunner.run(automation.id, this.props.items),
        })
      );
    }
    menu.popup({ window: getCurrentWindow() });
  };

  render() {
    const commands = this._commands();
    return (
      <BindGlobalCommands
        key={JSON.stringify(Object.keys(commands)) + this.state.revision}
        commands={commands}
      >
        <button
          className="btn btn-toolbar automation-toolbar-button"
          title={localized('Automations')}
          aria-label={localized('Automations')}
          onClick={this._openMenu}
        >
          {localized('Automations')}
        </button>
      </BindGlobalCommands>
    );
  }
}
