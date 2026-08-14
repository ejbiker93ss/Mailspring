import { ComponentRegistry, WorkspaceStore } from 'mailspring-exports';

import MailAssistant from '../../message-list/lib/mail-assistant';
import { CompactCalendarSidebar } from '../../main-calendar/lib/compact-calendar-sidebar';
import SidebarVisibilityControls from './sidebar-visibility-controls';

// ComponentRegistry keys registrations by component identity. Separate classes
// let the same control follow whichever primary mail column owns the toolbar in
// the current layout without rendering twice in split view.
class MessageToolbarSidebarControls extends SidebarVisibilityControls {
  static displayName = 'MessageToolbarSidebarControls';
}

class ThreadToolbarSidebarControls extends SidebarVisibilityControls {
  static displayName = 'ThreadToolbarSidebarControls';
}

export function activate() {
  ComponentRegistry.register(MailAssistant, {
    location: WorkspaceStore.Location.MessageListSidebar,
  });
  ComponentRegistry.register(CompactCalendarSidebar, {
    location: WorkspaceStore.Location.CalendarSidebar,
  });
  ComponentRegistry.register(MessageToolbarSidebarControls, {
    location: WorkspaceStore.Location.MessageList.Toolbar,
  });
  ComponentRegistry.register(ThreadToolbarSidebarControls, {
    location: WorkspaceStore.Location.ThreadList.Toolbar,
    modes: ['list', 'splitVertical'],
  });
}

export function deactivate() {
  ComponentRegistry.unregister(MailAssistant);
  ComponentRegistry.unregister(CompactCalendarSidebar);
  ComponentRegistry.unregister(MessageToolbarSidebarControls);
  ComponentRegistry.unregister(ThreadToolbarSidebarControls);
}
