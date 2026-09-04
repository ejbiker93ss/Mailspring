import React, { Component } from 'react';
import { Thread } from 'summermail-exports';
import { MultiselectToolbar } from 'summermail-component-kit';
import InjectsToolbarButtons, { ToolbarRole } from './injects-toolbar-buttons';

interface ThreadListToolbarProps {
  items: Thread[];
  injectedButtons: any;
  selection: { clear: () => void };
}
class ThreadListToolbar extends Component<ThreadListToolbarProps> {
  static displayName = 'ThreadListToolbar';

  onClearSelection = () => {
    this.props.selection.clear();
  };

  render() {
    const { injectedButtons, items } = this.props;

    return (
      <MultiselectToolbar
        collection="thread"
        selectionCount={items.length}
        toolbarElement={injectedButtons}
        onClearSelection={this.onClearSelection}
      />
    );
  }
}

const toolbarProps = {
  extraRoles: [`ThreadList:${ToolbarRole}`],
};

export default InjectsToolbarButtons(ThreadListToolbar, toolbarProps);
