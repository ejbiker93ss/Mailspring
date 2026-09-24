import React from 'react';
import { AccountStore, WorkspaceStore, localized } from 'summermail-exports';
import { TaskSource, ProviderTask, taskSources, taskRow, taskChanges } from './provider-task-data';

interface State {
  accountId: string;
  sources: TaskSource[];
  sourceId: string;
  rows: ProviderTask[];
  busy: boolean;
  error: string;
  next: string;
  more: boolean;
  edit: ProviderTask | null;
  original: ProviderTask | null;
  confirmDelete: boolean;
  confirmDiscard: boolean;
  draggingTaskId: string;
  dragOverStatus: string;
}

type TaskStatus = [string, string];

// Preserve the editor across workspace navigation, without persisting private notes to disk.
let suspendedEditor: State | null = null;

export default class ProviderTasks extends React.Component<Record<string, never>, State> {
  static displayName = 'ProviderTasks';
  private alive = false;
  private generation = 0;
  private timer: ReturnType<typeof setInterval>;
  private unlisten: () => void;
  private running = 0;
  state: State = {
    accountId: '',
    sources: [],
    sourceId: '',
    rows: [],
    busy: false,
    error: '',
    next: '',
    more: false,
    edit: null,
    original: null,
    confirmDelete: false,
    confirmDiscard: false,
    draggingTaskId: '',
    dragOverStatus: '',
  };
  accounts = () =>
    AccountStore.accounts().filter((a) => a.provider === 'smartermail' || a.usesMicrosoftGraph());
  smartermail = () => AccountStore.accountForId(this.state.accountId)?.provider === 'smartermail';
  source = () => this.state.sources.find((s) => s.id === this.state.sourceId);
  statuses = (): TaskStatus[] =>
    this.smartermail()
      ? [
          ['0', 'Not started'],
          ['2', 'In progress'],
          ['1', 'Completed'],
          ['3', 'Canceled'],
        ]
      : [
          ['notStarted', 'Not started'],
          ['inProgress', 'In progress'],
          ['completed', 'Completed'],
          ['waitingOnOthers', 'Waiting on others'],
          ['deferred', 'Deferred'],
        ];

  componentDidMount() {
    this.alive = true;
    this.unlisten = AccountStore.listen(() => {
      if (!this.accounts().some((a) => a.id === this.state.accountId))
        this.selectAccount(this.accounts()[0]?.id || '');
    });
    if (suspendedEditor && this.accounts().some((a) => a.id === suspendedEditor.accountId)) {
      this.setState({ ...suspendedEditor, busy: false });
      suspendedEditor = null;
    } else {
      suspendedEditor = null;
      this.selectAccount(this.accounts()[0]?.id || '');
    }
    this.timer = setInterval(() => {
      if (
        !document.hidden &&
        WorkspaceStore.rootSheet() === WorkspaceStore.Sheet.Kanban &&
        !this.state.busy &&
        !this.state.error &&
        !this.state.edit &&
        this.state.rows.length <= 100 &&
        this.state.sourceId
      )
        this.load();
    }, 60000);
  }
  componentWillUnmount() {
    suspendedEditor = this.state.edit
      ? {
          ...this.state,
          busy: false,
          error: this.state.busy
            ? localized(
                'An operation was still running. Check Refresh before retrying a change; your edits are retained.'
              )
            : this.state.error,
        }
      : null;
    this.alive = false;
    this.generation++;
    clearInterval(this.timer);
    this.unlisten?.();
  }
  request = (operation: string, extra = {}) =>
    AppEnv.mailsyncBridge.requestProviderTasks(this.state.accountId, {
      operation,
      sourceId: this.state.sourceId,
      owner: this.source()?.owner,
      ...extra,
    });
  run = async (work: () => Promise<void>) => {
    const generation = this.generation;
    this.running++;
    this.setState({ busy: true, error: '' });
    try {
      await work();
    } catch (error) {
      if (this.alive && generation === this.generation)
        this.setState({
          error: error.message || localized('Unable to synchronize tasks. Try Refresh.'),
        });
    } finally {
      this.running--;
      if (this.alive) this.setState({ busy: this.running > 0 });
    }
  };
  selectAccount = (accountId: string) => {
    this.generation++;
    this.setState(
      {
        accountId,
        sourceId: '',
        sources: [],
        rows: [],
        edit: null,
        original: null,
        more: false,
        next: '',
        error: '',
        busy: false,
        draggingTaskId: '',
        dragOverStatus: '',
      },
      () => {
        if (accountId) this.loadSources();
      }
    );
  };
  loadSources = () =>
    this.run(async () => {
      const generation = this.generation;
      const sources: TaskSource[] = [];
      let next = '';
      // Task lists are normally few; cap automatic traversal to protect the server.
      for (let page = 0; page < 10; page++) {
        const data = await this.request('sources', { next });
        if (!this.alive || generation !== this.generation) return;
        sources.push(...taskSources(data, this.smartermail()));
        next = data['@odata.nextLink'] || '';
        if (!next) break;
      }
      if (next)
        throw new Error(
          localized('More than 1,000 task lists were returned. Please manage lists in webmail.')
        );
      this.setState({ sources, sourceId: sources[0]?.id || '' }, () => {
        if (sources.length) this.load();
      });
    });
  load = (append = false) =>
    this.run(async () => {
      const generation = this.generation;
      const data = await this.request('list', {
        skip: append ? this.state.rows.length : 0,
        next: append ? this.state.next : '',
      });
      if (!this.alive || generation !== this.generation) return;
      const raw = this.smartermail() ? data.results : data.value;
      if (!Array.isArray(raw))
        throw new Error(localized('The server returned an invalid task response.'));
      const rows = raw.map((t) => taskRow(t, this.smartermail()));
      const all = append ? [...this.state.rows, ...rows] : rows;
      this.setState({
        rows: all.filter((r, i) => all.findIndex((t) => t.id === r.id) === i),
        next: data['@odata.nextLink'] || '',
        more: this.smartermail()
          ? raw.length > 0 && all.length < data.totalCount
          : !!data['@odata.nextLink'],
      });
    });
  open = (row: ProviderTask) =>
    this.run(async () => {
      const generation = this.generation;
      const smartermail = this.smartermail();
      const data = await this.request('detail', { taskId: row.id });
      if (!this.alive || generation !== this.generation) return;
      const original = taskRow(smartermail ? data.details[0] : data, smartermail);
      this.setState({
        edit: { ...original },
        original,
        confirmDelete: false,
        confirmDiscard: false,
      });
    });
  create = () =>
    this.setState({
      original: null,
      confirmDelete: false,
      confirmDiscard: false,
      edit: {
        id: '',
        title: '',
        notes: '',
        due: '',
        status: this.smartermail() ? '0' : 'notStarted',
        priority: this.smartermail() ? '5' : 'normal',
        raw: {},
      },
    });
  save = () =>
    this.run(async () => {
      const generation = this.generation;
      const { edit, original } = this.state;
      await this.request('save', {
        taskId: edit.id,
        changes: taskChanges(edit, original, this.smartermail()),
      });
      if (this.alive && generation === this.generation)
        this.setState({ edit: null, original: null }, () => this.load());
    });
  remove = () =>
    this.run(async () => {
      const generation = this.generation;
      await this.request('delete', { taskId: this.state.edit.id });
      if (this.alive && generation === this.generation)
        this.setState({ edit: null, original: null, confirmDelete: false }, () => this.load());
    });
  moveToStatus = (row: ProviderTask, status: string) => {
    if (
      row.status === status ||
      this.state.busy ||
      this.state.edit ||
      this.source()?.readOnly ||
      row.raw.isDelegatedByOwner
    )
      return;
    const updated = { ...row, status };
    this.run(async () => {
      const generation = this.generation;
      await this.request('save', {
        taskId: row.id,
        changes: taskChanges(updated, row, this.smartermail()),
      });
      if (!this.alive || generation !== this.generation) return;
      this.setState(
        {
          rows: this.state.rows.map((candidate) => (candidate.id === row.id ? updated : candidate)),
          draggingTaskId: '',
          dragOverStatus: '',
        },
        () => this.load()
      );
    });
  };
  dropTask = (event: React.DragEvent, status: string) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || this.state.draggingTaskId;
    const row = this.state.rows.find((candidate) => candidate.id === taskId);
    this.setState({ draggingTaskId: '', dragOverStatus: '' });
    if (row) this.moveToStatus(row, status);
  };
  field = (name: keyof ProviderTask, value: string) =>
    this.setState({ edit: { ...this.state.edit, [name]: value }, confirmDiscard: false });
  closeEditor = () => {
    const dirty =
      Object.keys(taskChanges(this.state.edit, this.state.original, this.smartermail())).length > 0;
    if (dirty && !this.state.confirmDiscard) {
      this.setState({ confirmDiscard: true });
      return;
    }
    this.setState({ edit: null, original: null, confirmDelete: false, confirmDiscard: false });
  };
  render() {
    const { busy, edit, rows } = this.state;
    const readOnly = this.source()?.readOnly || !!edit?.raw.isDelegatedByOwner;
    const statuses = this.statuses();
    const knownStatuses = new Set(statuses.map(([value]) => value));
    const unknownRows = rows.filter((row) => !knownStatuses.has(row.status));
    const lanes: Array<{
      value: string;
      title: string;
      rows: ProviderTask[];
      acceptsDrop: boolean;
    }> = [
      ...statuses.map(([value, title]) => ({
        value,
        title,
        rows: rows.filter((row) => row.status === value),
        acceptsDrop: true,
      })),
      ...(unknownRows.length
        ? [
            {
              value: '__other__',
              title: 'Other',
              rows: unknownRows,
              acceptsDrop: false,
            },
          ]
        : []),
    ];
    return (
      <section className="provider-tasks" aria-label={localized('Tasks')}>
        <header className="provider-tasks-toolbar">
          <div className="provider-tasks-heading">
            <h1>{localized('Tasks')}</h1>
            <p>{localized('Move tasks between lanes to update their status.')}</p>
          </div>
          <div className="provider-tasks-controls">
            <select
              aria-label={localized('Task account')}
              disabled={busy || !!edit}
              value={this.state.accountId}
              onChange={(e) => this.selectAccount(e.target.value)}
            >
              {this.accounts().map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emailAddress}
                </option>
              ))}
            </select>
            <select
              aria-label={localized('Task list')}
              disabled={busy || !!edit}
              value={this.state.sourceId}
              onChange={(e) => {
                this.generation++;
                this.setState({ sourceId: e.target.value, rows: [], next: '', more: false }, () =>
                  this.load()
                );
              }}
            >
              {this.state.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.readOnly ? localized(' (read only)') : ''}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={busy || !this.state.accountId}
              onClick={() => (this.state.sourceId ? this.load() : this.loadSources())}
            >
              {localized('Refresh')}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !!edit || !this.source() || readOnly}
              onClick={this.create}
            >
              {localized('New task')}
            </button>
          </div>
        </header>
        {this.state.error && (
          <p role="alert" className="provider-tasks-error">
            {this.state.error}
          </p>
        )}
        <div role="status" className="provider-tasks-status">
          {busy
            ? localized('Synchronizing tasks…')
            : edit
              ? localized(
                  'Edits are not saved until you choose Save task. Refresh keeps your edits.'
                )
              : localized(
                  'Tasks refresh every minute. Drag a card or use its status menu to update it.'
                )}
        </div>
        {!this.accounts().length && (
          <p>{localized('Add a SmarterMail API or Microsoft 365 account to use server tasks.')}</p>
        )}
        <div className="provider-tasks-content">
          <div className="provider-tasks-board-wrap">
            <div className="provider-tasks-board" aria-busy={busy}>
              {lanes.map((lane) => (
                <section
                  className={`provider-task-lane${
                    this.state.draggingTaskId ? ' drag-active' : ''
                  }${this.state.dragOverStatus === lane.value ? ' drag-over' : ''}`}
                  key={lane.value}
                  onDragEnter={(event) => {
                    if (!lane.acceptsDrop || readOnly || edit) return;
                    event.preventDefault();
                    this.setState({ dragOverStatus: lane.value });
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node))
                      this.setState({ dragOverStatus: '' });
                  }}
                  onDragOver={(event) => {
                    if (!lane.acceptsDrop || readOnly || edit) {
                      event.dataTransfer.dropEffect = 'none';
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => lane.acceptsDrop && this.dropTask(event, lane.value)}
                >
                  <header className="provider-task-lane-header">
                    <h2>{localized(lane.title)}</h2>
                    <span
                      className="provider-task-count"
                      aria-label={`${localized('Task count')}: ${lane.rows.length}`}
                    >
                      {lane.rows.length}
                    </span>
                  </header>
                  <div className="provider-task-cards">
                    {lane.rows.length ? (
                      lane.rows.map((row) => {
                        const canMove = !readOnly && !row.raw.isDelegatedByOwner;
                        return (
                          <article
                            className={`provider-task-card${!canMove ? ' read-only' : ''}${
                              edit?.id === row.id ? ' selected' : ''
                            }`}
                            key={row.id}
                            draggable={canMove && !busy && !edit}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', row.id);
                              this.setState({ draggingTaskId: row.id });
                            }}
                            onDragEnd={() =>
                              this.setState({ draggingTaskId: '', dragOverStatus: '' })
                            }
                          >
                            <button
                              className="provider-task-card-main"
                              disabled={busy || !!edit}
                              onClick={() => this.open(row)}
                            >
                              <strong>{row.title || localized('Untitled task')}</strong>
                              {row.notes ? <span>{row.notes}</span> : null}
                            </button>
                            <footer>
                              <span className={row.due ? 'provider-task-due' : ''}>
                                {row.due || localized('No due date')}
                              </span>
                              {canMove ? (
                                <select
                                  aria-label={`${localized('Move task')}: ${row.title}`}
                                  disabled={busy || !!edit}
                                  value={row.status}
                                  onDragStart={(event) => event.stopPropagation()}
                                  onChange={(event) => this.moveToStatus(row, event.target.value)}
                                >
                                  {!knownStatuses.has(row.status) ? (
                                    <option value={row.status}>{row.status}</option>
                                  ) : null}
                                  {statuses.map(([value, title]) => (
                                    <option key={value} value={value}>
                                      {localized(title)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span>{localized('Read only')}</span>
                              )}
                            </footer>
                          </article>
                        );
                      })
                    ) : (
                      <div className="provider-task-lane-empty">
                        {rows.length ? localized('Drop task here') : localized('No tasks')}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
            {this.state.more && (
              <div className="provider-tasks-more">
                <button className="btn" disabled={busy || !!edit} onClick={() => this.load(true)}>
                  {localized('Load more tasks')}
                </button>
              </div>
            )}
          </div>
          {edit && (
            <form
              className="provider-task-editor"
              onSubmit={(e) => {
                e.preventDefault();
                this.save();
              }}
            >
              <h2>{edit.id ? localized('Task details') : localized('New task')}</h2>
              <fieldset disabled={busy || readOnly}>
                <label>
                  {localized('Title')}
                  <input
                    autoFocus
                    required
                    maxLength={500}
                    value={edit.title}
                    onChange={(e) => this.field('title', e.target.value)}
                  />
                </label>
                <label>
                  {localized('Notes')}
                  <textarea
                    rows={7}
                    value={edit.notes}
                    onChange={(e) => this.field('notes', e.target.value)}
                  />
                </label>
                <label>
                  {localized('Due date')}
                  <input
                    type="date"
                    value={edit.due}
                    onChange={(e) => this.field('due', e.target.value)}
                  />
                </label>
                <label>
                  {localized('Status')}
                  <select
                    value={edit.status}
                    onChange={(e) => this.field('status', e.target.value)}
                  >
                    {statuses.map(([value, title]) => (
                      <option key={value} value={value}>
                        {localized(title)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {localized('Priority')}
                  <select
                    value={edit.priority}
                    onChange={(e) => this.field('priority', e.target.value)}
                  >
                    {(this.smartermail()
                      ? Array.from({ length: 11 }, (_, i) => [String(i), String(i)])
                      : [
                          ['low', 'Low'],
                          ['normal', 'Normal'],
                          ['high', 'High'],
                        ]
                    ).map(([value, title]) => (
                      <option key={value} value={value}>
                        {localized(title)}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
              {readOnly && (
                <p>
                  {localized('This shared list is read only here. Use webmail to edit its tasks.')}
                </p>
              )}
              <footer>
                {!readOnly && (
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy || !edit.title.trim()}
                  >
                    {localized('Save task')}
                  </button>
                )}
                <button className="btn" type="button" disabled={busy} onClick={this.closeEditor}>
                  {this.state.confirmDiscard ? localized('Discard changes') : localized('Close')}
                </button>
                {edit.id && !readOnly && (
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      this.state.confirmDelete
                        ? this.remove()
                        : this.setState({ confirmDelete: true })
                    }
                  >
                    {this.state.confirmDelete
                      ? localized('Confirm delete from server')
                      : localized('Delete task')}
                  </button>
                )}
              </footer>
            </form>
          )}
        </div>
      </section>
    );
  }
}
