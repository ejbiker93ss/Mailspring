import path from 'path';
import { fork, ChildProcess } from 'child_process';
import DatabaseStore from '../flux/stores/database-store';
import { Message } from '../flux/models/message';
import * as Actions from '../flux/actions';

const START_DELAY_MS = 20000;

export function startAttachmentSearch() {
  if (!AppEnv.isMainWindow() || AppEnv.inSpecMode()) return;
  let worker: ChildProcess | null = null;
  let disposed = false;
  const timer = setTimeout(() => {
    if (disposed) return;
    try {
      worker = fork(path.join(__dirname, 'attachment-search', 'worker.js'), [], {
        silent: true,
        ...{ windowsHide: true },
        execArgv: ['--max-old-space-size=64'],
      });
      worker.stdout?.resume();
      worker.stderr?.on('data', (data) => console.warn(data.toString().trim()));
      worker.on('error', (error) => console.warn('Attachment indexer unavailable:', error.message));
      worker.on('exit', () => {
        worker = null;
      });
      worker.send(
        {
          type: 'start',
          mailPath: path.join(AppEnv.getConfigDirPath(), 'edgehill.db'),
          filesRoot: path.join(AppEnv.getConfigDirPath(), 'files'),
        },
        (error) => {
          if (error) console.warn('Attachment indexer could not start:', error.message);
        }
      );
    } catch (error) {
      console.warn('Attachment indexer unavailable:', error.message);
    }
  }, START_DELAY_MS);

  const unsubscribe = DatabaseStore.listen((change) => {
    if (change.objectClass !== Message || !worker?.connected) return;
    const ids = change.objects.map((message: Message) => message.id).slice(0, 200);
    worker.send({ type: 'messages', ids }, (error) => {
      if (error) console.warn('Attachment indexing notification failed:', error.message);
    });
  });
  const pauseForSearch = () => {
    if (!worker?.connected) return;
    worker.send({ type: 'pause' }, (error) => {
      if (error) console.warn('Attachment indexing pause failed:', error.message);
    });
  };
  const stopListeningForChanges = Actions.searchQueryChanged.listen(pauseForSearch);
  const stopListeningForSearches = Actions.searchQuerySubmitted.listen(pauseForSearch);
  window.addEventListener(
    'unload',
    () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      stopListeningForChanges();
      stopListeningForSearches();
      worker?.kill();
    },
    { once: true }
  );
}
