// Offline component regression checks; never contacts a provider or sends mail.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const React = require('../app/node_modules/react');
const Renderer = require('../app/node_modules/react-test-renderer');
const { act } = Renderer;
function load(file, dependencies) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports: {}, require: name => dependencies[name] || {}, Set, Map };
  vm.runInNewContext(output, context, { filename: file });
  return context.exports;
}
const corrections = load('app/internal_packages/composer/lib/composer-corrections.ts', {});
let card;
let applied;
let sent = 0;
let dismissed = 0;
const actions = { closePopover: () => card.unmount() };
const writing = load('app/internal_packages/composer/lib/composer-ai-actions.tsx', {
  react: React,
  './composer-corrections': corrections,
  'summermail-exports': { localized: text => text, Actions: actions },
});
const props = {
  kind: 'grammar', originalText: 'helo world. this are fine.', correctedText: 'Hello world. This is fine.',
  onApply: text => { applied = text; }, onSendAnyway: () => { sent++; }, onDismiss: () => { dismissed++; },
};
act(() => { card = Renderer.create(React.createElement(writing.ComposerAIReviewCard, props)); });
const boxes = card.root.findAllByType('input');
assert(boxes.length > 1, 'All corrections must be separately selectable');
act(() => boxes[0].props.onChange());
act(() => card.root.findAllByType('button').find(b => b.props.children === 'Apply and Send').props.onClick());
assert.strictEqual(applied, 'helo world. This is fine.');
act(() => card.root.findAllByType('button').find(b => b.props.children === 'Send Anyway').props.onClick());
assert.strictEqual(sent, 1);
act(() => card.unmount());
assert.strictEqual(dismissed, 1);
act(() => { card = Renderer.create(React.createElement(writing.ComposerAIReviewCard, {kind:'error', error:'Offline', onSendAnyway:props.onSendAnyway})); });
act(() => card.root.findAllByType('button').find(b => b.props.children === 'Send Anyway').props.onClick());
assert.strictEqual(sent, 2);
act(() => card.unmount());
console.log('PASS: multiple selectable corrections, selected output, send-anyway, dismissal, and error bypass.');
