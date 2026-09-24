const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 }
}).outputText;
const data = {};
vm.runInNewContext(compile('app/internal_packages/mail-kanban/lib/provider-task-data.ts'), { exports: data });
class Component {
  setState(update, callback) { Object.assign(this.state, update); callback?.(); }
}
const account = { id: 'a', provider: 'smartermail' };
const mocks = {
  react: { default: { Component } },
  'summermail-exports': {
    localized: s => s,
    AccountStore: { accounts: () => [account], accountForId: () => account, listen: () => () => {} },
    WorkspaceStore: {}
  },
  './provider-task-data': data
};
const exportsUI = {};
vm.runInNewContext(compile('app/internal_packages/mail-kanban/lib/provider-tasks.tsx'), {
  exports: exportsUI, require: name => mocks[name], setInterval: () => 1, clearInterval: () => {}
});
const Tasks = exportsUI.default;
(async () => {
  const ui = new Tasks();
  ui.alive = true;
  ui.state.accountId = 'a';
  ui.create();
  ui.field('title', 'Keep my draft');
  ui.closeEditor();
  assert.equal(ui.state.confirmDiscard, true);
  assert.equal(ui.state.edit.title, 'Keep my draft');
  ui.componentWillUnmount();
  const restored = new Tasks();
  restored.componentDidMount();
  assert.equal(restored.state.edit.title, 'Keep my draft');
  restored.closeEditor();
  assert.equal(restored.state.edit, null);
  let resolve;
  restored.request = () => new Promise(r => { resolve = r; });
  const pending = restored.open({ id: 'old-account-task' });
  restored.generation++;
  resolve({ details: [{ id: 'old-account-task', subject: 'Wrong account' }] });
  await pending;
  assert.equal(restored.state.edit, null);
  assert.equal(restored.state.busy, false);
  restored.create();
  restored.field('title', 'Preserve after failure');
  restored.request = async () => { throw new Error('Uncertain save'); };
  await restored.save();
  assert.equal(restored.state.edit.title, 'Preserve after failure');
  assert.equal(restored.state.error, 'Uncertain save');
  console.log('PASS: draft confirmation, navigation retention, stale detail isolation, busy cleanup, failed-save retention');
})().catch(error => { console.error(error); process.exitCode = 1; });
