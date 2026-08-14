import fs from 'fs';
import path from 'path';
import MailspringStore from 'mailspring-store';
import * as Actions from '../actions';
import { CrossAccountMoveFolderTask } from '../tasks/cross-account-move-folder-task';
import { ChangeFolderTask } from '../tasks/change-folder-task';
import { Thread } from '../models/thread';
import DatabaseStore from './database-store';
import CategoryStore from './category-store';
import TaskQueue from './task-queue';

class CrossAccountTransferStore extends MailspringStore {
  private _advancing = new Set<string>();
  private _reportedErrors = new Set<string>();

  constructor() {
    super();
    if (!AppEnv.isMainWindow()) return;
    this.listenTo(TaskQueue, this._onQueueChanged);
    setTimeout(this._onQueueChanged, 0);
  }

  private _onQueueChanged = () => {
    const transfers = TaskQueue.findTasks(
      CrossAccountMoveFolderTask,
      {},
      {
        includeCompleted: true,
      }
    ) as CrossAccountMoveFolderTask[];
    const cleanupTasks = TaskQueue.findTasks(
      ChangeFolderTask,
      {},
      {
        includeCompleted: true,
      }
    ) as ChangeFolderTask[];

    const byTransfer = new Map<string, CrossAccountMoveFolderTask[]>();
    for (const task of transfers) {
      if (!task.transferId || !task.phase) continue;
      const group = byTransfer.get(task.transferId) || [];
      group.push(task);
      byTransfer.set(task.transferId, group);
    }

    for (const [transferId, tasks] of byTransfer) {
      const prepare = tasks.find((task) => task.phase === 'prepare');
      const imported = tasks.find((task) => task.phase === 'import');
      const cleanup = cleanupTasks.find((task) => task.crossAccountTransferId === transferId);

      if (cleanup && cleanup.status === 'complete') {
        if (cleanup.error) this._reportError(cleanup, 'removing the source mail');
        else this._cleanupStaging(prepare && prepare.stagingDirectory);
        continue;
      }

      if (imported && imported.status === 'complete') {
        if (imported.error) {
          this._reportError(imported, 'importing mail into the destination account');
        } else if (imported.deleteFromSource) {
          // A missing staging directory after a completed import means this
          // transfer was already finalized and cleaned up in an earlier run.
          if (!imported.stagingDirectory || !fs.existsSync(imported.stagingDirectory)) continue;
          this._queueSourceCleanup(imported);
        } else {
          this._cleanupStaging(imported.stagingDirectory);
        }
        continue;
      }

      if (!imported && prepare && prepare.status === 'complete') {
        if (prepare.error) {
          this._reportError(prepare, 'reading mail from the source account');
        } else {
          this._queueImport(prepare);
        }
      }
    }
  };

  private _queueImport(prepare: CrossAccountMoveFolderTask) {
    const key = `${prepare.transferId}:import`;
    if (this._advancing.has(key)) return;
    const files = prepare.result && prepare.result.files;
    if (!files || files.length === 0) {
      this._reportError(prepare, 'preparing mail (no RFC822 files were produced)');
      return;
    }
    this._advancing.add(key);
    Actions.queueTask(
      new CrossAccountMoveFolderTask({
        phase: 'import',
        transferId: prepare.transferId,
        sourceAccountId: prepare.sourceAccountId,
        targetAccountId: prepare.targetAccountId,
        targetFolder: prepare.targetFolder,
        threadIds: prepare.threadIds,
        deleteFromSource: prepare.deleteFromSource,
        stagingDirectory: prepare.stagingDirectory,
        files,
        source: 'Cross-account drag and drop',
      })
    );
  }

  private async _queueSourceCleanup(imported: CrossAccountMoveFolderTask) {
    const key = `${imported.transferId}:cleanup`;
    if (this._advancing.has(key)) return;
    this._advancing.add(key);
    try {
      const trash = CategoryStore.getTrashCategory(imported.sourceAccountId);
      if (!trash) throw new Error('The source account does not have a Trash folder configured.');
      const threads = await DatabaseStore.modelify<Thread>(Thread, imported.threadIds);
      if (!threads || threads.length !== imported.threadIds.length) {
        throw new Error('One or more source conversations are no longer available.');
      }
      Actions.queueTask(
        new ChangeFolderTask({
          threads,
          folder: trash as any,
          source: 'Cross-account move (destination copy completed)',
          crossAccountTransferId: imported.transferId,
        })
      );
    } catch (error) {
      this._reportError(imported, `removing the source mail: ${error}`);
    }
  }

  private _reportError(task: CrossAccountMoveFolderTask | ChangeFolderTask, step: string) {
    const key = `${task.id}:${step}`;
    if (this._reportedErrors.has(key)) return;
    this._reportedErrors.add(key);
    const detail = task.error ? JSON.stringify(task.error) : 'Unknown error';
    AppEnv.showErrorDialog({
      title: 'Cross-Account Transfer Failed',
      message: `Mailspring failed while ${step}. The source mail was not deleted.\n\n${detail}`,
    });
  }

  private _cleanupStaging(directory: string) {
    if (!directory) return;
    const root = path.resolve(AppEnv.getConfigDirPath(), 'cross-account-transfers');
    const target = path.resolve(directory);
    if (target === root || !target.startsWith(`${root}${path.sep}`)) {
      console.warn(`Refusing to remove invalid cross-account staging path: ${directory}`);
      return;
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `Unable to remove cross-account transfer staging directory ${directory}:`,
        error
      );
    }
  }
}

export default new CrossAccountTransferStore();
