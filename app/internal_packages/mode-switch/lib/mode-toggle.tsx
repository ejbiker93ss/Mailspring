import React from 'react';
import SidebarVisibilityControls from './sidebar-visibility-controls';

export default class ModeToggle extends React.Component<Record<string, unknown>> {
  static displayName = 'ModeToggle';

  render() {
    return <SidebarVisibilityControls />;
  }
}
