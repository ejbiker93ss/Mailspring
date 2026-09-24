import React from 'react';
import { localized } from 'summermail-exports';
import MailKanban from './mail-kanban';
import ProviderTasks from './provider-tasks';

export default function KanbanWorkspace() {
  const [tasks, setTasks] = React.useState(false);
  return (
    <div className="kanban-workspace">
      <nav className="kanban-workspace-tabs" aria-label={localized('Kanban view')}>
        <button className="btn" aria-pressed={!tasks} onClick={() => setTasks(false)}>
          {localized('Mail folders')}
        </button>
        <button className="btn" aria-pressed={tasks} onClick={() => setTasks(true)}>
          {localized('Tasks')}
        </button>
      </nav>
      {tasks ? <ProviderTasks /> : <MailKanban />}
    </div>
  );
}

KanbanWorkspace.displayName = 'KanbanWorkspace';
