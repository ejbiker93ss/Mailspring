import React from 'react';
import ReactDOM from 'react-dom';
import { Actions } from 'mailspring-exports';
import { Menu } from './menu';

export type AppContextMenuItem =
  | { id?: string; label: string; click: () => void }
  | { id?: string; type: 'separator' };

interface AppContextMenuProps {
  items: AppContextMenuItem[];
  x: number;
  y: number;
  onDismiss: () => void;
}

interface AppContextMenuState {
  left: number;
  top: number;
}

class AppContextMenu extends React.Component<AppContextMenuProps, AppContextMenuState> {
  private menuElement?: HTMLDivElement;

  constructor(props: AppContextMenuProps) {
    super(props);
    this.state = { left: props.x, top: props.y };
  }

  componentDidMount() {
    window.addEventListener('blur', this.props.onDismiss);
    window.addEventListener('resize', this.props.onDismiss);
    window.requestAnimationFrame(() => {
      if (!this.menuElement) return;
      const rect = this.menuElement.getBoundingClientRect();
      const margin = 8;
      this.setState({
        left: Math.max(margin, Math.min(this.props.x, window.innerWidth - rect.width - margin)),
        top: Math.max(margin, Math.min(this.props.y, window.innerHeight - rect.height - margin)),
      });
      (this.menuElement.querySelector('.menu') as HTMLElement)?.focus();
    });
  }

  componentWillUnmount() {
    window.removeEventListener('blur', this.props.onDismiss);
    window.removeEventListener('resize', this.props.onDismiss);
  }

  _select = (item: AppContextMenuItem) => {
    if ('type' in item) return;
    this.props.onDismiss();
    item.click();
  };

  _content = (item: AppContextMenuItem) => {
    if ('type' in item) return <Menu.Item key={item.id} divider />;
    return <span className="primary">{item.label}</span>;
  };

  render() {
    return (
      <div
        className="app-context-menu-backdrop"
        onMouseDown={this.props.onDismiss}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div
          ref={(element) => (this.menuElement = element)}
          className="app-context-menu"
          role="menu"
          tabIndex={-1}
          style={{ left: this.state.left, top: this.state.top }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Menu
            items={this.props.items}
            itemKey={(item) => item.id}
            itemContent={this._content}
            onSelect={this._select}
            onEscape={this.props.onDismiss}
            defaultSelectedIndex={-1}
          />
        </div>
      </div>
    );
  }
}

let contextMenuContainer: HTMLDivElement | null = null;

export function dismissAppContextMenu() {
  if (!contextMenuContainer) return;
  ReactDOM.unmountComponentAtNode(contextMenuContainer);
  contextMenuContainer.remove();
  contextMenuContainer = null;
}

export function showAppContextMenu(
  items: AppContextMenuItem[],
  { x, y }: { x: number; y: number }
) {
  dismissAppContextMenu();
  Actions.closePopover();
  contextMenuContainer = document.createElement('div');
  contextMenuContainer.className = 'app-context-menu-root';
  document.body.appendChild(contextMenuContainer);
  const identifiedItems = items.map((item, index) => ({ ...item, id: `context-item-${index}` }));
  ReactDOM.render(
    <AppContextMenu items={identifiedItems} x={x} y={y} onDismiss={dismissAppContextMenu} />,
    contextMenuContainer
  );
}
