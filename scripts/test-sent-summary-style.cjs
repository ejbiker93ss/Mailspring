const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ts = require('typescript');
const React = require('../app/node_modules/react');
const { renderToStaticMarkup } = require('../app/node_modules/react-dom/server');
const source = fs.readFileSync(path.join(__dirname, '../app/src/components/composer-editor/base-block-plugins.tsx'), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText;
const context = {exports:{},require:name => {
  if (name === 'react') return React;
  if (name === './toolbar-component-factories') return {BuildToggleButton:()=>null};
  return function() { return {}; };
}};
vm.runInNewContext(code,context);
const render = (className,children,targetIsHTML=true) => context.exports.BLOCK_CONFIG.div.render({
  node:{data:{get:()=>className},text:'Summary',isLeafBlock:()=>false},attributes:{},children,targetIsHTML,
});
const html = renderToStaticMarkup(render('ai-composer-summary',[
  React.cloneElement(render('ai-composer-summary-label','AI summary · previous messages'),{key:'label'}),
  React.createElement('p',{key:'body'},'The team agreed to review the schedule on Friday.'),
  React.createElement('ul',{key:'list'},React.createElement('li',null,'Confirm the deadline.')),
]));
assert(html.includes('border:1px solid #999999'));
assert(html.includes('font-style:italic'));
assert(html.includes('font-style:normal'));
assert(!html.includes('background'));
assert(!/(?:^|[;" ])color:/.test(html));
assert(!renderToStaticMarkup(render('ordinary-paragraph','Untouched')).includes('style='));
assert(renderToStaticMarkup(render('ai-composer-summary','Preview',false)).includes('border:1px solid'));
console.log('PASS: inline summary border and italics in sent HTML and preview; no text/background color; ordinary paragraphs unchanged.');
if (process.argv.includes('--visual')) {
  (async()=>{
    const browser = await require('playwright').chromium.launch({channel:'msedge',headless:true});
    try {
      const page = await browser.newPage({viewport:{width:900,height:500}});
      await page.setContent(`<body style="font:15px Arial;padding:20px"><h3>Sent email — no application styles</h3>${html}<hr><div style="background:#222;color:#eee;padding:20px">${html}</div></body>`);
      await page.screenshot({path:path.join(__dirname,'../.tmp-sent-summary.png')});
    } finally { await browser.close(); }
  })().catch(e=>{console.error(e);process.exit(1);});
}
