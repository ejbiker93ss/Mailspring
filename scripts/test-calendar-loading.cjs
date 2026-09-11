const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = process.env.CALENDAR_TEST_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const Rx = require(path.join(root, 'app/node_modules/rx-lite'));
function loadSource(name) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'app/internal_packages/main-calendar/lib/core', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const context = { exports: {}, console, performance, setTimeout, clearTimeout,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    require: name => {
      if (name === './calendar-occurrence-loader') return loadSource('calendar-occurrence-loader');
      if (name === 'summermail-exports') return {
        ICSEventHelpers: { isRecurringEvent: ics => /RRULE:|RDATE:/.test(ics) },
        Contact: class { isMe() { return false; } },
      };
      return require(path.join(root, 'app/node_modules', name));
    },
  };
  vm.runInNewContext(code, context);
  return context.exports;
}
const { CalendarOccurrenceLoader } = loadSource('calendar-occurrence-loader');
const { occurrencesForEvents } = loadSource('calendar-data-source');
const range = { startUnix: Date.parse('2026-09-01T00:00:00Z')/1000, endUnix: Date.parse('2026-09-30T23:59:59Z')/1000 };
function fixture(id = 'series') {
  return { id, accountId: 'account', calendarId: 'calendar', icsuid: id, recurrenceId: '', ics: [
    'BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT',`UID:${id}`,'DTSTART:20200102T150000Z',
    'DTEND:20200102T160000Z','RRULE:FREQ=DAILY','SUMMARY:Meeting','END:VEVENT','END:VCALENDAR',
  ].join('\r\n') };
}
const read = observable => new Promise((resolve, reject) => observable.subscribe(resolve, reject));
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
(async () => {
  let calls = 0;
  const loader = new CalendarOccurrenceLoader((...args) => { calls++; return occurrencesForEvents(...args); });
  const event = fixture();
  let complete = false;
  const pending = read(loader.load([event], range, 'me')).then(r => { complete = true; return r; });
  assert.equal(calls, 0, 'expansion must not block subscription/tab activation');
  assert.equal(complete, false);
  assert.equal((await pending).events.length, 30);
  await read(loader.load([{...event}], range, 'me'));
  assert.equal(calls, 1, 'unchanged rows must survive a remount without re-expansion');
  event.ics = event.ics.replace('SUMMARY:Meeting','SUMMARY:Updated');
  assert.equal((await read(loader.load([event], range, 'me'))).events[0].title, 'Updated');
  assert.equal(calls, 2, 'in-place edits must invalidate the cache');
  await read(loader.load([event], {...range, endUnix: range.endUnix-86400}, 'me'));
  await read(loader.load([event], range, 'new identity'));
  assert.equal(calls, 4, 'date range and attendee identity changes must invalidate');
  assert.equal((await read(loader.load([], range, 'me'))).events.length, 0, 'deleted/disabled events must disappear');
  console.log('PASS: deferred activation, cache reuse, edit/range/identity invalidation, deletions');

  const anotherCalendar = {...event, id:'other', calendarId:'other'};
  assert.equal((await read(loader.load([event, anotherCalendar], range, 'me'))).events.length, 60);
  console.log('PASS: identical UIDs in separate calendars retain both sets of occurrences');

  let cancelledCalls = 0;
  const cancelledLoader = new CalendarOccurrenceLoader(() => { cancelledCalls++; return []; });
  const disposable = cancelledLoader.load([event], range, 'me').subscribe(() => assert.fail('cancelled load emitted'));
  disposable.dispose();
  await pause();
  assert.equal(cancelledCalls, 0);

  let batchCalls = 0;
  const batchLoader = new CalendarOccurrenceLoader(() => {
    batchCalls++;
    const started = performance.now();
    while(performance.now()-started < 10) {}
    return [];
  });
  let betweenBatches = 0;
  const heartbeat = setInterval(() => { betweenBatches++; }, 1);
  await read(batchLoader.load(Array.from({length:5},(_,i)=>fixture(String(i))), range, 'me'));
  clearInterval(heartbeat);
  assert.equal(batchCalls, 5);
  assert(betweenBatches >= 5, 'UI timers must run between expensive series');

  let sub;
  batchCalls = 0;
  const stopLoader = new CalendarOccurrenceLoader(() => {
    batchCalls++;
    setTimeout(() => sub.dispose(),0);
    const started = performance.now();
    while(performance.now()-started < 10) {}
    return [];
  });
  sub = stopLoader.load([fixture('one'),fixture('two')],range,'me').subscribe(()=>assert.fail('cancelled batch emitted'));
  await pause();
  assert.equal(batchCalls, 1);
  console.log('PASS: cancellation before work and between batches; UI gets time between series');

  const changes = new Rx.Subject();
  const seen = [];
  const switched = changes.flatMapLatest(events => loader.load(events,range,'me')).subscribe(r=>seen.push(r));
  changes.onNext([fixture('stale')]);
  changes.onNext([]);
  await pause();
  switched.dispose();
  assert.equal(seen.length,1);
  assert.equal(seen[0].events.length,0);
  console.log('PASS: replaced queries cannot emit stale results');

  let evictedCalls = 0;
  const bounded = new CalendarOccurrenceLoader(() => { evictedCalls++; return []; });
  await read(bounded.load(Array.from({length:257},(_,i)=>fixture(String(i))),range,'me'));
  await read(bounded.load([fixture('0')],range,'me'));
  assert.equal(evictedCalls,258);
  console.log('PASS: cache size is bounded');

  if(process.argv.includes('--benchmark')) {
    const sample = Array.from({length:150},(_,i)=>fixture(String(i)));
    let started = performance.now();
    const expected = occurrencesForEvents(sample,range);
    const synchronousMs = Math.round(performance.now()-started);
    let maxBlockMs=0;
    let previous=performance.now();
    const pulse=setInterval(()=>{const now=performance.now();maxBlockMs=Math.max(maxBlockMs,now-previous);previous=now;},1);
    const measured = new CalendarOccurrenceLoader(occurrencesForEvents);
    started = performance.now();
    const first = await read(measured.load(sample,range,'me'));
    const firstMs = Math.round(performance.now()-started);
    clearInterval(pulse);
    assert.equal(JSON.stringify(first.events),JSON.stringify(expected));
    started = performance.now();
    const cached = await read(measured.load(sample.map(e=>({...e})),range,'me'));
    assert.equal(JSON.stringify(cached.events),JSON.stringify(expected));
    console.log(JSON.stringify({series:sample.length,occurrences:expected.length,synchronousMs,firstMs,maxBlockMs:Math.round(maxBlockMs),cachedMs:Math.round(performance.now()-started)}));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
