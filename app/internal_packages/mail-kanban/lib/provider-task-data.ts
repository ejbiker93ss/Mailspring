export interface TaskSource {
  id: string;
  name: string;
  owner: string;
  readOnly: boolean;
}
export interface ProviderTask {
  id: string;
  title: string;
  notes: string;
  due: string;
  status: string;
  priority: string;
  raw: any;
}

export function taskSources(data: any, smartermail: boolean): TaskSource[] {
  const rows = smartermail ? data : data.value;
  if (!Array.isArray(rows)) throw new Error('The server returned an invalid task-list response.');
  return rows.map((s) => ({
    id: s.id,
    name: s.name || s.displayName,
    owner: s.owner || '',
    readOnly: smartermail ? !!s.isSharedItem : s.isOwner === false,
  }));
}

export function plainNotes(value: string): string {
  const doc = new DOMParser().parseFromString(value || '', 'text/html');
  doc.querySelectorAll('br').forEach((node) => node.replaceWith(doc.createTextNode('\n')));
  doc.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr').forEach((node) => {
    node.appendChild(doc.createTextNode('\n'));
  });
  return (doc.body.textContent || '').replace(/\n$/, '');
}

export function taskRow(raw: any, smartermail: boolean): ProviderTask {
  const date = (smartermail ? raw.due : raw.dueDateTime?.dateTime)?.slice(0, 10) || '';
  return {
    id: raw.id,
    title: smartermail ? raw.subject : raw.title,
    notes: smartermail
      ? plainNotes(raw.description)
      : raw.body?.contentType?.toLowerCase() === 'html'
        ? plainNotes(raw.body.content)
        : raw.body?.content || '',
    due: date >= '0100-01-01' && (!smartermail || raw.useDateTime !== false) ? date : '',
    status: smartermail ? String(raw.status ?? 0) : raw.status || 'notStarted',
    priority: smartermail ? String(raw.priority ?? 5) : raw.importance || 'normal',
    raw,
  };
}

export function taskChanges(
  task: ProviderTask,
  original: ProviderTask | null,
  smartermail: boolean
) {
  const changed = (key: keyof ProviderTask) => !original || task[key] !== original[key];
  const result: Record<string, any> = {};
  if (changed('title')) result[smartermail ? 'subject' : 'title'] = task.title.trim();
  if (changed('notes')) {
    if (smartermail)
      result.description = task.notes
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    else result.body = { content: task.notes, contentType: 'text' };
  }
  if (changed('status')) {
    result.status = smartermail ? Number(task.status) : task.status;
    if (smartermail)
      result.percentComplete =
        task.status === '1'
          ? 100
          : task.status === '0'
            ? 0
            : Math.min(original?.raw.percentComplete || 0, 99);
  }
  if (changed('priority'))
    result[smartermail ? 'priority' : 'importance'] = smartermail
      ? Number(task.priority)
      : task.priority;
  if (changed('due')) {
    if (smartermail) {
      result.due = task.due ? `${task.due}T17:00:00` : null;
      result.useDateTime = !!task.due;
      if (!task.due) result.start = null;
      if (!original && task.due) result.start = `${task.due}T09:00:00`;
    } else
      result.dueDateTime = task.due ? { dateTime: `${task.due}T00:00:00`, timeZone: 'UTC' } : null;
  }
  return result;
}
