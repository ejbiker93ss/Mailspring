import { ComponentRegistry, WorkspaceStore } from 'summermail-exports';
import MailKanban from './kanban-workspace';

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
