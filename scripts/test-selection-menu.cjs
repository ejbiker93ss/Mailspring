// Exercise the actual components in an isolated Electron window, without mail accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('@playwright/test');

async function main() {
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, '.tmp', 'selection-menu-'));
  const entry = path.join(directory, 'main.cjs');
  fs.writeFileSync(
    entry,
    `process.on('uncaughtException',()=>{console.error('Selection-menu test startup failed');process.exit(1)});
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(()=>{const window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});return window.loadURL('about:blank');}).catch(()=>app.exit(1));`
  );
  const app = await _electron.launch({ args: [entry] });
  try {
    const page = await app.firstWindow();
    const results = await page.evaluate(async (root) => {
      const fs = window.require('fs');
      const path = window.require('path');
      const ts = window.require(path.join(root, 'node_modules/typescript'));
      const React = window.require(path.join(root, 'app/node_modules/react'));
      const ReactDOM = window.require(path.join(root, 'app/node_modules/react-dom'));
      const cache = {};
      const copied = [];
      const quoted = [];
      const exportsStub = {
        Actions: { closePopover() {} },
        Utils: {
          fastOmit: (object, keys) =>
            Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key))),
        },
        localized: (text) => text,
        SummerMailAPIRequest: { rootURLForServer() {} },
        DOMUtils: { scrollAdjustmentToMakeNodeVisibleInContainer: () => 0 },
      };
      function load(file) {
        if (cache[file]) return cache[file];
        const module = { exports: {} };
        cache[file] = module.exports;
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          compilerOptions: {
            jsx: ts.JsxEmit.React,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
          },
        }).outputText;
        const localRequire = (name) => {
          if (name === 'summermail-exports') return exportsStub;
          if (name.includes('iframe-searcher')) return {};
          if (name === '@electron/remote')
            return {
              clipboard: {
                write: (value) => copied.push(value),
                writeText: (text) => copied.push({ text }),
              },
            };
          if (name.startsWith('.')) {
            const base = path.resolve(path.dirname(file), name);
            return load(
              [base + '.tsx', base + '.ts'].find((candidate) => fs.existsSync(candidate))
            );
          }
          return window.require(
            window.require.resolve(name, { paths: [path.join(root, 'app'), root] })
          );
        };
        new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
        return module.exports;
      }
      const menu = load(path.join(root, 'app/src/components/app-context-menu.tsx'));
      const { EventedIFrame } = load(path.join(root, 'app/src/components/evented-iframe.tsx'));
      const container = document.createElement('div');
      document.body.append(container);
      const frame = ReactDOM.render(
        React.createElement(EventedIFrame, {
          src: 'about:blank',
          onQuoteSelection: (text) => quoted.push(text),
        }),
        container
      );
      const iframe = container.querySelector('iframe');
      await new Promise((resolve) => setTimeout(resolve, 30));
      iframe.contentDocument.body.innerHTML = '<p id="text">Selected email text</p>';
      const selection = iframe.contentWindow.getSelection();
      const select = () => {
        const range = iframe.contentDocument.createRange();
        range.selectNodeContents(iframe.contentDocument.querySelector('#text'));
        selection.removeAllRanges();
        selection.addRange(range);
      };
      const open = () => {
        select();
        frame._showSelectionQuoteActions(iframe, iframe.getBoundingClientRect());
      };
      const visible = () => !!document.querySelector('.app-context-menu-root');
      open();
      const labels = [...document.querySelectorAll('.app-context-menu .primary')].map(
        (element) => element.textContent
      );
      frame._onIFrameMouseEvent(new MouseEvent('mousemove'));
      const keptOnMove = visible();
      frame._onIFrameMouseEvent(new MouseEvent('mousedown', { button: 0 }));
      frame._onIFrameMouseEvent(new MouseEvent('mouseup', { button: 0 }));
      const stayedDismissed = !visible() && selection.toString() === '';
      open();
      const freshSelectionOpens = visible();
      const outside = document.createElement('button');
      document.body.append(outside);
      outside.addEventListener('mousedown', (event) => event.stopPropagation());
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const outsideCloses = !visible();
      frame._onIFrameMouseEvent(new MouseEvent('mouseup', { button: 0 }));
      const outsideReleaseStaysClosed = !visible() && selection.toString() === '';
      open();
      document
        .querySelector('.app-context-menu .item')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const copyWorks =
        copied[0]?.text === 'Selected email text' &&
        copied[0]?.html.includes('Selected email text');
      const confirmationVisible =
        visible() && document.querySelector('.confirmation')?.textContent === 'Copied';
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const confirmationCloses = !visible();
      open();
      const quote = [...document.querySelectorAll('.app-context-menu .item')].find(
        (element) => element.textContent === 'Quote'
      );
      quote.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const quoteWorks = quoted.join() === 'Selected email text' && !visible();
      window.selectionMenuTest = { open, visible };
      const style = document.createElement('style');
      style.textContent = (await window.require(path.join(root, 'app/node_modules/less')).render(
        fs.readFileSync(path.join(root, 'app/static/style/components/app-context-menu.less'), 'utf8')
          .replace("@import 'ui-variables';", ''),
        { globalVars: { 'background-secondary': '#fff', 'border-color-divider': '#ddd',
          black: '#000', 'text-color': '#222', 'font-size-base': '14px',
          'color-success': '#080', 'font-weight-semi-bold': '600' } }
      )).css;
      document.head.append(style);
      open();
      window.selectionMenuTest.unmount = () => {
        ReactDOM.unmountComponentAtNode(container);
        return !visible();
      };
      return {
        labels,
        keptOnMove,
        stayedDismissed,
        freshSelectionOpens,
        outsideCloses,
        outsideReleaseStaysClosed,
        copyWorks,
        confirmationVisible,
        confirmationCloses,
        quoteWorks,
      };
    }, root);
    assert.deepEqual(results.labels, ['Copy', 'Copy as Plain Text', 'Copy Quote', 'Quote']);
    for (const [name, result] of Object.entries(results)) {
      if (name !== 'labels') assert.equal(result, true, name);
    }
    // Use Chromium input and hit testing, including mouseup falling through the
    // removed backdrop into the email iframe.
    for (const point of [{ x: 280, y: 140 }, { x: 500, y: 300 }]) {
      await page.evaluate(() => window.selectionMenuTest.open());
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.evaluate(() => window.selectionMenuTest.visible()), false,
        'physical outside click keeps menu closed');
    }
    await page.evaluate(() => window.selectionMenuTest.open());
    assert.equal(await page.evaluate(() => window.selectionMenuTest.unmount()), true,
      'unmount closes menu');
    console.log(
      'PASS selection menu: alphabetical actions, iframe and outside dismissal, fresh selection, copy confirmation, quote, unmount'
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
