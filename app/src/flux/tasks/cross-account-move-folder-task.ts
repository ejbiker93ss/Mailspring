import { Task } from './task';
import { Folder } from '../models/folder';
import { Thread } from '../models/thread';
import * as Attributes from '../attributes';
import { AttributeValues } from '../models/model';

export type CrossAccountTransferPhase = 'prepare' | 'import';

export interface CrossAccountTransferFile {
  filepath: string;
  messageId: string;
  headerMessageId: string;
  date: number;
  unread: boolean;
  starred: boolean;
}

export interface CrossAccountTransferResult {
  files?: CrossAccountTransferFile[];
  appendedMessageIds?: string[];
  skippedMessageIds?: string[];
  total?: number;
  completed?: number;
}

/**
 * A durable, two-phase cross-account transfer. The source account's native
 * sync worker prepares RFC822 files; the target account's worker imports them.
 * CrossAccountTransferStore advances the task between phases and removes the
 * source only after the native import completes without an error.
 *
 * The legacy `threads` attribute remains so old completed task records can be
 * inflated safely after upgrading.
 */
export class CrossAccountMoveFolderTask extends Task {
  static attributes = {
    ...Task.attributes,
    phase: Attributes.String({ modelKey: 'phase' }),
    transferId: Attributes.String({ modelKey: 'transferId' }),
    threadIds: Attributes.Collection({ modelKey: 'threadIds' }),
    threads: Attributes.Collection({ modelKey: 'threads', itemClass: Thread }),
    sourceAccountId: Attributes.String({ modelKey: 'sourceAccountId' }),
    targetFolder: Attributes.Obj({ modelKey: 'targetFolder', itemClass: Folder }),
    targetAccountId: Attributes.String({ modelKey: 'targetAccountId' }),
    deleteFromSource: Attributes.Boolean({ modelKey: 'deleteFromSource' }),
    stagingDirectory: Attributes.String({ modelKey: 'stagingDirectory' }),
    files: Attributes.Collection({ modelKey: 'files' }),
    result: Attributes.Obj({ modelKey: 'result' }),
  };

  phase: CrossAccountTransferPhase;
  transferId: string;
  threadIds: string[];
  threads: Thread[];
  sourceAccountId: string;
  targetFolder: Folder;
  targetAccountId: string;
  deleteFromSource: boolean;
  stagingDirectory: string;
  files: CrossAccountTransferFile[];
  result: CrossAccountTransferResult;

  constructor(
    data: AttributeValues<typeof CrossAccountMoveFolderTask.attributes> & {
      threads?: Thread[];
    } = {}
  ) {
    const { threads = [], ...rest } = data;
    super(rest);

    // Records from the retired implementation have no phase. Leave them as
    // history-only models; they are already complete and will never be queued.
    if (!data.phase && data.status) {
      this.threads = threads;
      return;
    }

    this.phase = this.phase || 'prepare';
    this.threadIds = this.threadIds || threads.map((thread) => thread.id);
    this.sourceAccountId =
      this.sourceAccountId || (threads[0] && threads[0].accountId) || this.accountId;
    this.transferId = this.transferId || this.id;
    this.accountId = this.phase === 'import' ? this.targetAccountId : this.sourceAccountId;
  }

  fromJSON(json: any) {
    super.fromJSON(json);
    if (!json.phase) {
      // The registry constructs an empty instance before calling fromJSON.
      // Clear constructor defaults for legacy history records.
      this.phase = undefined;
      this.transferId = undefined;
      this.threadIds = undefined;
    }
    return this;
  }

  willBeQueued() {
    if (!['prepare', 'import'].includes(this.phase)) {
      throw new Error(`CrossAccountMoveFolderTask: invalid phase ${this.phase}.`);
    }
    if (!this.sourceAccountId || !this.targetAccountId) {
      throw new Error('CrossAccountMoveFolderTask: source and target accounts are required.');
    }
    if (this.sourceAccountId === this.targetAccountId) {
      throw new Error('CrossAccountMoveFolderTask: source and target accounts must differ.');
    }
    if (
      !(this.targetFolder instanceof Folder) ||
      this.targetFolder.accountId !== this.targetAccountId
    ) {
      throw new Error(
        'CrossAccountMoveFolderTask: a folder owned by the target account is required.'
      );
    }
    if (!this.stagingDirectory) {
      throw new Error('CrossAccountMoveFolderTask: stagingDirectory is required.');
    }
    if (this.phase === 'prepare' && (!this.threadIds || this.threadIds.length === 0)) {
      throw new Error('CrossAccountMoveFolderTask: at least one source thread is required.');
    }
    if (this.phase === 'import' && (!this.files || this.files.length === 0)) {
      throw new Error('CrossAccountMoveFolderTask: prepared RFC822 files are required.');
    }
  }

  label() {
    const verb = this.deleteFromSource ? 'Moving' : 'Copying';
    return this.phase === 'import'
      ? `${verb} mail to ${this.targetFolder ? this.targetFolder.displayName : 'another account'}`
      : `Preparing mail for ${verb.toLowerCase()}`;
  }

  description() {
    return this.label();
  }

  numberOfImpactedItems() {
    return (this.threadIds && this.threadIds.length) || (this.files && this.files.length) || 1;
  }
}
