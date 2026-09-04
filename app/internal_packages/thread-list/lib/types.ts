import { Message, Thread } from 'summermail-exports';

export interface ThreadWithMessagesMetadata extends Thread {
  __messages: Message[];
}
