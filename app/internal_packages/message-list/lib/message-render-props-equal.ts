import { Message, Utils } from 'summermail-exports';

const messageListComparisons = new WeakMap<Message[], WeakMap<Message[], boolean>>();

// Every row receives the same immutable thread list. Compare a pair of lists
// once so a cache refresh does not repeat that full scan for every message.
export function messageRenderPropsEqual<T extends { messages: Message[] }>(next: T, previous: T) {
  const { messages: nextMessages, ...nextProps } = next;
  const { messages: previousMessages, ...previousProps } = previous;
  if (!Utils.isEqualReact(nextProps, previousProps)) return false;
  if (nextMessages === previousMessages) return true;

  let comparisons = messageListComparisons.get(previousMessages);
  if (!comparisons) {
    comparisons = new WeakMap<Message[], boolean>();
    messageListComparisons.set(previousMessages, comparisons);
  }
  const cached = comparisons.get(nextMessages);
  if (cached !== undefined) return cached;

  const equal = Utils.isEqualReact(nextMessages, previousMessages);
  comparisons.set(nextMessages, equal);
  return equal;
}
