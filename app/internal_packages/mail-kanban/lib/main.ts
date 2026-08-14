import { ComponentRegistry, WorkspaceStore } from 'mailspring-exports';
import MailKanban from './mail-kanban';

export function activate() {
  WorkspaceStore.defineSheet('Kanban', { root: true }, { list: ['KanbanContent'] });
  ComponentRegistry.register(MailKanban, {
    location: WorkspaceStore.Location.KanbanContent,
  });
}

export function deactivate() {
  ComponentRegistry.unregister(MailKanban);
  WorkspaceStore.undefineSheet('Kanban');
}
