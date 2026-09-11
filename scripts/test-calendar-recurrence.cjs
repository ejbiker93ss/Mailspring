const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.CALENDAR_TEST_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const icalModule = require(path.join(root, 'app/node_modules/ical.js'));
const ICAL = icalModule.default || icalModule;
const source = fs.readFileSync(path.join(root, 'app/internal_packages/main-calendar/lib/core/calendar-data-source.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
} }).outputText;
const context = { exports: {}, console, require: name => {
  if (name === './calendar-occurrence-loader') {
    const loaderSource = fs.readFileSync(path.join(root, 'app/internal_packages/main-calendar/lib/core/calendar-occurrence-loader.ts'), 'utf8');
    const loaderCode = ts.transpileModule(loaderSource, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    const loaderContext = { exports: {}, require: context.require };
    vm.runInNewContext(loaderCode, loaderContext);
    return loaderContext.exports;
  }
  if (name === 'summermail-exports') return {
    ICSEventHelpers: { isRecurringEvent: ics => new ICAL.Event(new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')).isRecurring() },
    Contact: class { isMe() { return false; } },
  };
  return require(path.join(root, 'app/node_modules', name));
} };
vm.runInNewContext(code, context);
const expand = context.exports.occurrencesForEvents;
const range = { startUnix: Date.parse('2026-09-01T00:00:00Z') / 1000, endUnix: Date.parse('2026-09-30T23:59:59Z') / 1000 };
function fixture(rule, extra = '', start = '20200102T150000Z', end = '20200102T160000Z') {
  return { id: 'master', accountId: 'account', calendarId: 'calendar', icsuid: 'test', recurrenceId: '', ics: [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:test', `DTSTART:${start}`, `DTEND:${end}`,
    'SUMMARY:Meeting', ...(rule ? [`RRULE:${rule}`] : []), ...extra.split('\n').filter(Boolean), 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n') };
}
function check(name, run) { run(); console.log(`PASS: ${name}`); }
check('weekly meetings beyond the first 100 occurrences remain visible', () => {
  const result = expand([fixture('FREQ=WEEKLY;BYDAY=TH')], range);
  assert.deepEqual(Array.from(result, e => new Date(e.start * 1000).toISOString()), [
    '2026-09-03T15:00:00.000Z', '2026-09-10T15:00:00.000Z', '2026-09-17T15:00:00.000Z', '2026-09-24T15:00:00.000Z',
  ]);
});
check('daily meetings beyond even the library default of 1000 remain visible', () => {
  assert.equal(expand([fixture('FREQ=DAILY')], range).length, 30);
});
check('COUNT and UNTIL still stop completed series', () => {
  assert.equal(expand([fixture('FREQ=WEEKLY;COUNT=100')], range).length, 0);
  assert.equal(expand([fixture('FREQ=WEEKLY;UNTIL=20260831T235959Z')], range).length, 0);
});
check('EXDATE still suppresses an occurrence in an old series', () => {
  const result = expand([fixture('FREQ=WEEKLY;BYDAY=TH', 'EXDATE:20260910T150000Z')], range);
  assert.equal(result.length, 3);
  assert(!result.some(e => e.start === Date.parse('2026-09-10T15:00:00Z') / 1000));
});
check('inline moved exceptions replace old-series occurrences', () => {
  const event = fixture('FREQ=WEEKLY;BYDAY=TH');
  event.ics = event.ics.replace('END:VCALENDAR', [
    'BEGIN:VEVENT', 'UID:test', 'RECURRENCE-ID:20260910T150000Z',
    'DTSTART:20260910T170000Z', 'DTEND:20260910T180000Z', 'SUMMARY:Moved', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'));
  const result = expand([event], range);
  assert.equal(result.length, 4);
  assert(result.some(e => e.title === 'Moved' && e.start === Date.parse('2026-09-10T17:00:00Z') / 1000));
  assert(!result.some(e => e.start === Date.parse('2026-09-10T15:00:00Z') / 1000));
});
check('single events and events outside the visible range are unchanged', () => {
  assert.equal(expand([fixture('', '', '20260910T150000Z', '20260910T160000Z')], range).length, 1);
  assert.equal(expand([fixture('')], range).length, 0);
});

check('unbounded or reversed ranges cannot start unlimited expansion', () => {
  for (const invalid of [
    { ...range, endUnix: Infinity }, { ...range, startUnix: NaN },
    { startUnix: range.endUnix, endUnix: range.startUnix },
  ]) assert.throws(() => expand([fixture('FREQ=DAILY')], invalid), /finite, ordered date range/);
});
