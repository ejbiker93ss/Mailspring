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
const slate = require('../app/node_modules/slate');
const textCorrections = load('app/src/components/composer-editor/composer-text-corrections.ts', { slate });
let card;
let applied;
let sent = 0;
let dismissed = 0;
const actions = { closePopover: () => card.unmount() };
const writing = load('app/internal_packages/composer/lib/composer-ai-actions.tsx', {
  react: React,
  './composer-corrections': corrections,
  '../../../src/components/composer-editor/composer-text-corrections': textCorrections,
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

const text = (value, marks = []) => ({object:'text', leaves:[{text:value, marks}]});
const image = cid => ({object:'inline', type:'image', data:{contentId:cid, imgProps:{width:320,height:180}}, nodes:[text('')]});
const paragraph = nodes => ({object:'block', type:'paragraph', nodes});
const list = items => ({object:'block', type:'bulleted-list', nodes:items});
const item = nodes => ({object:'block', type:'list-item', nodes});
const value = slate.Value.fromJSON({document:{nodes:[
  paragraph([text('  helo ', [{type:'bold'}]), image('snip-one'), text('wrld. '),
    {object:'inline', type:'link', data:{href:'https://example.invalid'}, nodes:[text('clik here')]}]),
  paragraph([image('snip-two')]),
  paragraph([text('this are fine.  ')]),
  {object:'block', type:'uneditable', data:{html:'<img src="cid:signature">'}, nodes:[text('')]},
  {object:'block', type:'blockquote', nodes:[paragraph([text('Quoted text')])]},
]}});
const editor = new slate.Editor({value, schema:{inlines:{image:{isVoid:true}},blocks:{uneditable:{isVoid:true}}}});
const before = editor.value.document;
const leading = before.nodes.take(3).toArray();
const attachments = [before.getInlines().find(n=>n.type==='image'), before.getInlines().filter(n=>n.type==='image').last()];
const oldLink = before.getInlines().find(n=>n.type==='link');
textCorrections.applyEditableTextCorrections(editor, leading, 'Hello world. Click here\n\nThis is fine.');
const after = editor.value.document;
assert.strictEqual(after.nodes.take(3).map(n=>n.text).join('\n').trim(), 'Hello world. Click here\n\nThis is fine.');
for (const img of attachments) assert.deepStrictEqual(after.getNode(img.key).toJSON(), img.toJSON());
assert.strictEqual(after.getNode(oldLink.key).data.get('href'), 'https://example.invalid');
assert(after.getFirstText().getMarksAtIndex(3).some(m=>m.type==='bold'));
assert.deepStrictEqual(after.nodes.skip(3).toJS(), before.nodes.skip(3).toJS());
// CID HTML is what the send path uses to retain attached bytes.
const Html = require('../app/node_modules/slate-html-serializer').default;
const serializer = new Html({rules:[{serialize(node, children) {
  if (node.object==='inline' && node.type==='image') return React.createElement('img',{src:'cid:'+node.data.get('contentId')});
  if (node.object==='block') return React.createElement('div',null,children);
  if (node.object==='inline') return React.createElement('span',null,children);
  if (node.object==='mark') return React.createElement('strong',null,children);
}}]});
const html = serializer.serialize(editor.value);
const files = [{contentId:'snip-one'}, {contentId:'snip-two'}, {filename:'report.pdf'}];
assert.strictEqual(files.filter(f=>!(f.contentId && !html.includes(`cid:${f.contentId}`))).length, 3);
const snapshot = editor.value.document.toJSON();
assert.throws(()=>textCorrections.applyEditableTextCorrections(editor, editor.value.document.nodes.take(3).toArray(), 'Merged all paragraphs'), /paragraph/);
assert.deepStrictEqual(editor.value.document.toJSON(), snapshot);
console.log('PASS: corrections preserve pasted images, CID attachment retention, links, marks, signatures and quotes; unsafe paragraph changes leave the draft untouched.');

const formattedValue = slate.Value.fromJSON({document:{nodes:[
  paragraph([text('I need these two PRs merged to support the kiosk go-live:')]),
  list([
    item([paragraph([{object:'inline',type:'link',data:{href:'https://github.com/msse-dev/Central/pull/1945'},nodes:[text('#1945',[{type:'bold'}])]}, text(': '), text('Adds visitor host selection', [{type:'bold'}]), text(' and arrival notifications.')])]),
    item([paragraph([{object:'inline',type:'link',data:{href:'https://github.com/msse-dev/Central/pull/1955'},nodes:[text('#1955',[{type:'bold'}])]}, text(': '), text('Fixes iPad layout and navigation', [{type:'bold'}]), text(' when the onscreen keyboard opens.')])]),
  ]),
]}});
const formattedEditor = new slate.Editor({value:formattedValue, schema:{}});
const formattedNodes = formattedEditor.value.document.nodes.toArray();
const linksBefore = formattedEditor.value.document.getInlines().filter(n=>n.type==='link').toArray();
assert.strictEqual(
  textCorrections.editableTextForWritingCheck(formattedEditor, formattedNodes),
  'I need these two PRs merged to support the kiosk go-live:\n#1945: Adds visitor host selection and arrival notifications.\n#1955: Fixes iPad layout and navigation when the onscreen keyboard opens.'
);
textCorrections.applyEditableTextCorrections(
  formattedEditor,
  formattedNodes,
  'I need these two PRs merged to support the kiosk go-live:\n#1945: Adds visitor-host selection and arrival notifications.\n#1955: Fixes iPad layout and navigation when the on-screen keyboard opens.'
);
const formattedAfter = formattedEditor.value.document;
assert.strictEqual(formattedAfter.nodes.get(1).type, 'bulleted-list');
assert.strictEqual(formattedAfter.nodes.get(1).nodes.size, 2);
assert.strictEqual(
  textCorrections.editableTextForWritingCheck(formattedEditor, formattedAfter.nodes.toArray()),
  'I need these two PRs merged to support the kiosk go-live:\n#1945: Adds visitor-host selection and arrival notifications.\n#1955: Fixes iPad layout and navigation when the on-screen keyboard opens.'
);
for (const link of linksBefore) assert.deepStrictEqual(formattedAfter.getNode(link.key).toJSON(), link.toJSON());
const boldText = formattedAfter.getTexts().find(t=>t.text.includes('Adds visitor-host selection'));
assert(boldText.getMarksAtIndex(boldText.text.indexOf('visitor-host')).some(m=>m.type==='bold'));
console.log('PASS: Apply and Send edits only text inside nested list items and keeps the pasted list structure and bold styling.');
