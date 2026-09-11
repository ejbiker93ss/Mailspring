import Rx from 'rx-lite';
import type { Event } from 'summermail-exports';
import type { EventOccurrence } from './calendar-data-source';

type Range = { startUnix: number; endUnix: number };
type Expand = (events: Event[], range: Range) => EventOccurrence[];

// Retain a bounded set of series across calendar remounts. A changed ICS,
// visible range, or account identity must never reuse stale occurrences.
const MAX_CACHED_SERIES = 256;
const BATCH_MS = 8;

export class CalendarOccurrenceLoader {
  private cache = new Map<string, { signature: string; occurrences: EventOccurrence[] }>();

  constructor(private expand: Expand) {}

  load(events: Event[], range: Range, identity: string) {
    return Rx.Observable.create<{ events: EventOccurrence[] }>((observer) => {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout>;
      const grouped = new Map<string, Event[]>();
      for (const event of events) {
        const key = JSON.stringify([event.accountId, event.calendarId, event.icsuid]);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(event);
      }
      const groups = grouped.entries();
      const occurrences: EventOccurrence[] = [];

      const run = () => {
        if (cancelled) return;
        const started = performance.now();
        try {
          let next = groups.next();
          while (!next.done) {
            const [key, series] = next.value;
            const signature = JSON.stringify([
              range.startUnix,
              range.endUnix,
              identity,
              series.map((event) => [
                event.id,
                event.ics,
                event.recurrenceId,
                event.recurrenceStart,
                event.recurrenceEnd,
              ]),
            ]);
            const previous = this.cache.get(key);
            const expanded =
              previous?.signature === signature ? previous.occurrences : this.expand(series, range);
            this.cache.delete(key);
            this.cache.set(key, { signature, occurrences: expanded });
            if (this.cache.size > MAX_CACHED_SERIES) {
              this.cache.delete(this.cache.keys().next().value);
            }
            occurrences.push(...expanded);
            if (performance.now() - started >= BATCH_MS) {
              timer = setTimeout(run, 0);
              return;
            }
            next = groups.next();
          }
          observer.onNext({ events: occurrences });
          observer.onCompleted();
        } catch (error) {
          observer.onError(error);
        }
      };

      // Let the selected tab and calendar shell paint before starting expansion.
      const frame = requestAnimationFrame(() => {
        timer = setTimeout(run, 0);
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        clearTimeout(timer);
      };
    });
  }
}
