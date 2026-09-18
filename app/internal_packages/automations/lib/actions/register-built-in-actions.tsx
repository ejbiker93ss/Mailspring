import React from 'react';
import { pathToFileURL } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  Actions,
  AccountStore,
  AttachmentStore,
  AutomationActionRegistry,
  CategoryStore,
  ChangeFolderTask,
  DatabaseStore,
  DraftFactory,
  File,
  Folder,
  Message,
  SendDraftTask,
  SyncbackDraftTask,
  TaskFactory,
  TaskQueue,
} from 'summermail-exports';

const { BrowserWindow } = require('@electron/remote');

function escapeHtml(value = '') {
  return String(value).replace(
    /[&<>'"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]
  );
}

async function waitRemote(task: any) {
  Actions.queueTask(task);
  const finished = await TaskQueue.waitForPerformRemote(task);
  if (finished.error)
    throw new Error(finished.error.message || 'The mail server rejected this action.');
}

async function printHtml(title: string, html: string, deviceName = '') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'summermail-automation-print-'));
  const htmlPath = path.join(directory, 'print.html');
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: file:"><title>${escapeHtml(title)}</title><style>body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171a2f;margin:32px;line-height:1.45}header{border-bottom:1px solid #d8deeb;margin-bottom:18px;padding-bottom:12px}h1{font-size:20px;margin:0 0 6px}</style></head><body>${html}</body></html>`
  );
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  try {
    await window.loadURL(pathToFileURL(htmlPath).href);
    await new Promise<void>((resolve, reject) => {
      window.webContents.print(
        { silent: true, printBackground: true, deviceName },
        (success, failureReason) => {
          success
            ? resolve()
            : reject(new Error(failureReason || 'The printer rejected this job.'));
        }
      );
    });
  } finally {
    if (!window.isDestroyed()) window.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function messagesForThread(thread: any) {
  return DatabaseStore.findAll<Message>(Message, { threadId: thread.id })
    .include(Message.attributes.body)
    .order(Message.attributes.date.ascending());
}

async function materializeAttachment(file: File) {
  Actions.fetchFile(file);
  const deadline = Date.now() + 30_000;
  let lastError: Error = null;
  while (Date.now() < deadline) {
    try {
      const filePath = await (AttachmentStore as any).resolveFilePathForPreview(file);
      if (filePath && fs.existsSync(filePath)) return filePath;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`Timed out downloading ${file.safeDisplayName()}.`);
}

function moveFolderFor(thread: any, config: any) {
  const folderId = config?.foldersByAccountId?.[thread.accountId] || config?.folderId;
  return folderId ? CategoryStore.byId(thread.accountId, folderId) : null;
}

const input = (label: string, value: any, onChange: (value: string) => void, props: any = {}) => (
  <label className="automation-field">
    <span>{label}</span>
    <input value={value || ''} onChange={(event) => onChange(event.target.value)} {...props} />
  </label>
);

const FolderActionEditor = ({ config, onChange }) => {
  const foldersByAccountId = config.foldersByAccountId || {};
  const accounts = AccountStore.accounts();
  return (
    <div className="automation-folder-choices">
      {accounts.map((account) => {
        const folders = (CategoryStore.categories(account.id) || []).filter(
          (category) => category instanceof Folder
        );
        return (
          <label className="automation-field" key={account.id}>
            <span>{account.label || account.emailAddress}</span>
            <select
              value={foldersByAccountId[account.id] || ''}
              onChange={(event) =>
                onChange({
                  ...config,
                  foldersByAccountId: { ...foldersByAccountId, [account.id]: event.target.value },
                })
              }
            >
              <option value="">No destination for this account</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.displayName}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
};

export default function registerBuiltInActions() {
  const disposables = [];
  disposables.push(
    AutomationActionRegistry.register({
      type: 'mail.replyPreset',
      version: 1,
      label: 'Reply with preset message',
      description: 'Send a prepared reply immediately.',
      category: 'mail',
      risk: 'side-effect',
      createDefaultConfig: () => ({ body: '', replyAll: false }),
      summarize: (config) =>
        config.body
          ? `Reply: ${String(config.body)
              .replace(/<[^>]+>/g, '')
              .slice(0, 48)}`
          : 'Reply with a preset message',
      validate: (config) =>
        config?.body?.replace(/<[^>]+>/g, '').trim() ? [] : ['Enter a preset reply message.'],
      renderEditor: ({ config, onChange }) => (
        <>
          <label className="automation-field">
            <span>Preset message</span>
            <textarea
              value={config.body || ''}
              onChange={(event) => onChange({ ...config, body: event.target.value })}
            />
          </label>
          <label className="automation-checkbox">
            <input
              type="checkbox"
              checked={!!config.replyAll}
              onChange={(event) => onChange({ ...config, replyAll: event.target.checked })}
            />{' '}
            Reply all
          </label>
        </>
      ),
      execute: async ({ thread }, config) => {
        const messages = await messagesForThread(thread);
        const message = messages.filter((item) => !item.draft && !item.isHidden()).pop();
        if (!message) throw new Error(`No replyable message was found in “${thread.subject}”.`);
        const draft = await DraftFactory.createDraftForReply({
          thread,
          message,
          type: config.replyAll ? 'reply-all' : 'reply',
        });
        draft.body = draft.plaintext
          ? `${config.body}\n\n${draft.body || ''}`
          : `${config.body}<br><br>${draft.body || ''}`;
        draft.pristine = false;
        const save = new SyncbackDraftTask({ draft });
        Actions.queueTask(save);
        await TaskQueue.waitForPerformLocal(save);
        await waitRemote(SendDraftTask.forSending(draft));
      },
    })
  );
  disposables.push(
    AutomationActionRegistry.register({
      type: 'mail.moveToFolder',
      version: 1,
      label: 'Move to folder',
      description: 'Move the conversation to a folder.',
      category: 'organization',
      risk: 'destructive',
      createDefaultConfig: () => ({ foldersByAccountId: {} }),
      summarize: (config: any) => config.folderName || 'Move to selected folder',
      validate: (config: any) =>
        config?.folderId || Object.values(config?.foldersByAccountId || {}).some(Boolean)
          ? []
          : ['Choose a destination folder.'],
      renderEditor: FolderActionEditor,
      execute: async ({ thread }, config) => {
        const folder = moveFolderFor(thread, config);
        if (!(folder instanceof Folder))
          throw new Error(`The destination folder is unavailable for “${thread.subject}”.`);
        await waitRemote(new ChangeFolderTask({ source: 'Automation', threads: [thread], folder }));
      },
    })
  );
  disposables.push(
    AutomationActionRegistry.register({
      type: 'print.body',
      version: 1,
      label: 'Print message body',
      description: 'Silently print the latest message or full conversation.',
      category: 'printing',
      risk: 'side-effect',
      createDefaultConfig: () => ({ scope: 'latest', deviceName: '' }),
      summarize: (config) =>
        config.scope === 'thread' ? 'Print full conversation' : 'Print latest message body',
      validate: () => [],
      renderEditor: ({ config, onChange }) => (
        <>
          <label className="automation-field">
            <span>Content</span>
            <select
              value={config.scope || 'latest'}
              onChange={(event) => onChange({ ...config, scope: event.target.value })}
            >
              <option value="latest">Latest message</option>
              <option value="thread">Full conversation</option>
            </select>
          </label>
          {input(
            'Printer name (leave blank for the default printer)',
            config.deviceName,
            (deviceName) => onChange({ ...config, deviceName })
          )}
        </>
      ),
      execute: async ({ thread }, config) => {
        const messages = await messagesForThread(thread);
        const selected =
          config.scope === 'thread'
            ? messages.filter((item) => !item.draft)
            : [messages.filter((item) => !item.draft).pop()].filter(Boolean);
        if (!selected.length)
          throw new Error(`There is no message body to print in “${thread.subject}”.`);
        const content = selected
          .map(
            (message) =>
              `<article><header><h1>${escapeHtml(message.subject || thread.subject)}</h1><div>${escapeHtml(message.from?.[0]?.displayName?.() || 'Unknown sender')}</div></header>${message.body || `<p>${escapeHtml(message.snippet || '')}</p>`}</article>`
          )
          .join('<hr>');
        await printHtml(thread.subject || 'Message', content, config.deviceName);
      },
    })
  );
  disposables.push(
    AutomationActionRegistry.register({
      type: 'print.attachments',
      version: 1,
      label: 'Print matching PDF attachments',
      description: 'Print PDF attachments that match a filename pattern.',
      category: 'printing',
      risk: 'side-effect',
      createDefaultConfig: () => ({ pattern: '*.pdf', deviceName: '', noMatchFails: false }),
      summarize: (config) => `Print attachments matching ${config.pattern || '*.pdf'}`,
      validate: (config) => (!config?.pattern ? ['Enter a filename pattern.'] : []),
      renderEditor: ({ config, onChange }) => (
        <>
          {input(
            'Filename pattern',
            config.pattern || '*.pdf',
            (pattern) => onChange({ ...config, pattern }),
            { placeholder: '*.pdf' }
          )}
          <label className="automation-checkbox">
            <input
              type="checkbox"
              checked={!!config.noMatchFails}
              onChange={(event) => onChange({ ...config, noMatchFails: event.target.checked })}
            />{' '}
            Stop if no attachments match
          </label>
          {input(
            'Printer name (leave blank for the default printer)',
            config.deviceName,
            (deviceName) => onChange({ ...config, deviceName })
          )}
        </>
      ),
      execute: async ({ thread }, config) => {
        const pattern = String(config.pattern || '*.pdf')
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        const matcher = new RegExp(`^${pattern}$`, 'i');
        const messages = await messagesForThread(thread);
        const files = messages
          .flatMap((message) => message.files || [])
          .filter(
            (file: any) =>
              matcher.test(file.safeDisplayName()) &&
              (file.contentType === 'application/pdf' || file.displayExtension() === 'pdf')
          );
        if (!files.length) {
          if (config.noMatchFails) throw new Error(`No PDF attachments matched ${config.pattern}.`);
          return;
        }
        for (const file of files) {
          const filePath = await materializeAttachment(file as File);
          const window = new BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
          });
          try {
            await window.loadURL(pathToFileURL(filePath).href);
            await new Promise<void>((resolve, reject) =>
              window.webContents.print(
                { silent: true, printBackground: true, deviceName: config.deviceName || '' },
                (success, reason) =>
                  success
                    ? resolve()
                    : reject(new Error(reason || `Could not print ${file.safeDisplayName()}.`))
              )
            );
          } finally {
            if (!window.isDestroyed()) window.destroy();
          }
        }
      },
    })
  );
  disposables.push(
    AutomationActionRegistry.register({
      type: 'mail.moveToTrash',
      version: 1,
      label: 'Move to Trash',
      description: 'Delete recoverably by moving the conversation to Trash.',
      category: 'organization',
      risk: 'destructive',
      createDefaultConfig: () => ({}),
      summarize: () => 'Move conversation to Trash',
      validate: () => [],
      renderEditor: () => (
        <p className="automation-help">
          This is recoverable: the conversation is moved to Trash, not permanently deleted.
        </p>
      ),
      execute: async ({ thread }) => {
        const tasks = TaskFactory.tasksForMovingToTrash({
          threads: [thread],
          source: 'Automation',
        });
        if (!tasks.length) throw new Error(`Trash is unavailable for “${thread.subject}”.`);
        for (const task of tasks) await waitRemote(task);
      },
    })
  );
  return disposables;
}
