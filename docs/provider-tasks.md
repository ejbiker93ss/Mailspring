# Provider tasks

SummerMail exposes server-backed task lists under **Kanban → Tasks**. The existing
folder-backed mail Kanban is unchanged. Tasks are not mail folders or mail-engine
queue tasks.

## Providers and evidence

- Smarter-Mail reference checkout: `.tmp/Smarter-Mail-review`, commit `c9020af`.
  Its `artifacts/api-server/src/routes/tasks.ts` stores application tasks in
  PostgreSQL rather than synchronizing native SmarterMail tasks. Do not call its
  `/api/tasks` routes on a SmarterMail server.
- SmarterMail native contract: the server's
  `/Documentation/detail/SmarterMail.Web.Api.TasksController` and shipped web
  client, inspected September 19, 2026. Uses `GET /tasks/sources`,
  `POST /tasks/tasks-all`, `GET /tasks/{owner}/{source}/{task}`,
  `POST /tasks/save` (array of task objects), and `POST /tasks/delete`
  (array of source-owner/source-ID/task-ID objects).
- Microsoft To Do: Microsoft Graph v1.0 `/me/todo/lists` and
  `/me/todo/lists/{listId}/tasks` (or the configured Graph mailbox base).
  Requires delegated `Tasks.ReadWrite`; existing accounts may need reconnecting
  and administrator consent. This is To Do, not Microsoft Planner.
  See https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0.

## Data and safety

The renderer sends named operations to its existing native account worker.
No new token or password is returned to the task UI. One task operation per
account runs at a time, separately from interactive mail synchronization.

Lists load 100 tasks at a time. Load More requests the next page; errors retain
the prior visible rows. There is no destructive cache reconciliation. In-memory
rows refresh every minute only while this view is open and visible, the editor
is closed, there is no error, and only the first page has been loaded. Longer
lists use explicit Refresh. List enumeration is capped at 1,000 Graph lists.
Graph pagination URLs must remain under the exact task/list endpoint before
the worker sends its bearer token.

SmarterMail saves fetch current detail and merge only edited fields, retaining
recurrence, attachments, categories and other provider metadata. Its native
status values are **0 not started, 1 completed, 2 in progress, 3 canceled**.
Priority is 0–10 in its web client. Year-0001 dates mean no date, not an overdue
task. Completion sets percentComplete to 100; reopening resets it below 100.

Shared SmarterMail task lists are read-only in this first implementation, as
are delegated tasks. Graph non-owned lists are displayed read-only. Server
permissions remain authoritative. Deletion requires a second confirmation.
Uncertain save/delete outcomes never automatically retry; refresh before retrying.
Refresh remains available with the editor open and retains edited fields. Close
requires confirmation before discarding edits. Navigation retains the editor in
memory for the current app session; unsaved edits do not survive quitting the app.
If navigation interrupts an operation, its outcome is explicitly marked uncertain.

The editor offers title, plain-text notes, due date, status, and priority. Rich
notes are preserved unchanged unless edited. Recurrence, reminders, attachments,
list creation/sharing, email-to-task linking and offline editing are not exposed
by this initial editor. Existing provider values are not intentionally stripped.

## Verification

- `node scripts/test-provider-tasks.cjs`
- `node node_modules/typescript/bin/tsc -p app/tsconfig.json --noEmit`
- Native Windows mailsync build.
- Live read-only SmarterMail check returned one source and three tasks.
- Microsoft365 live consent/CRUD and SmarterMail live write verification require
  a suitable signed-in account and permission to create a disposable test task.
