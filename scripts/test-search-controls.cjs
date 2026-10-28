// Render the real controls in a disposable Electron profile, with no accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
async function main() {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, '.tmp', 'search-controls-'));
  const entry = path.join(directory, 'main.cjs');
  fs.writeFileSync(
    entry,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:900,height:400,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});w.loadURL('about:blank');});`
  );
  const app = await _electron.launch({ args: [entry] });
  try {
    const page = await app.firstWindow();
    const result = await page.evaluate(async (root) => {
      const fs = window.require('fs');
      const path = window.require('path');
      const ts = window.require(path.join(root, 'node_modules/typescript'));
      const React = window.require(path.join(root, 'app/node_modules/react'));
      const ReactDOM = window.require(path.join(root, 'app/node_modules/react-dom'));
      let menu = [];
      let isSearch = false;
      const perspectiveListeners = [];
      const pendingContacts = {};
      class Store {
        constructor() {
          this.listeners = [];
        }
        listen(fn) {
          this.listeners.push(fn);
          return () => {
            this.listeners = this.listeners.filter((v) => v !== fn);
          };
        }
        trigger() {
          this.listeners.forEach((fn) => fn());
        }
      }
      const RetinaImg = () => null;
      RetinaImg.Mode = {};
      const exportsStub = {
        React,
        localized: (text, value) => text.replace('%@', value),
        FocusedPerspectiveStore: {
          current: () => ({
            searchQuery: isSearch ? 'report' : '',
            accountIds: ['a'],
            isInbox: () => true,
          }),
          listen: (fn) => {
            perspectiveListeners.push(fn);
            return () => {};
          },
        },
        ContactStore: {
          searchContacts: (term) =>
            new Promise((resolve) => {
              pendingContacts[term] = resolve;
            }),
        },
        CategoryStore: {},
        Actions: {},
        WorkspaceStore: {},
        AccountStore: { accountForId: () => ({ label: 'Work' }) },
      };
      const cache = {};
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
          if (name === 'summermail-store') return Store;
          if (name === 'react') return React;
          if (name === '@electron/remote')
            return {
              Menu: {
                buildFromTemplate: (items) => {
                  menu = items;
                  return { popup() {} };
                },
              },
            };
          if (name === 'summermail-component-kit')
            return {
              RetinaImg,
              ListensToFluxStore: (component) => component,
              KeyCommandsRegion: ({ children, globalHandlers, ...props }) =>
                React.createElement('div', props, children),
            };
          if (name === './search-store') return {};
          if (name.startsWith('.')) {
            const base = path.resolve(path.dirname(file), name);
            return load(
              [base + '.ts', base + '.tsx'].find((candidate) => fs.existsSync(candidate))
            );
          }
          throw new Error('Unexpected module: ' + name);
        };
        new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
        return module.exports;
      }
      const state = load(path.join(root, 'app/src/flux/stores/unthreaded-state.ts')).default;
      const Controls = load(
        path.join(root, 'app/internal_packages/thread-list/lib/thread-list-controls.tsx')
      ).default;
      // Load the real package activation with unrelated components replaced so
      // registration omissions are caught, not just isolated button behavior.
      const registrations = [];
      const activationFile = path.join(root, 'app/internal_packages/thread-list/lib/main.ts');
      const activation = { exports: {} };
      const activationCode = ts.transpileModule(fs.readFileSync(activationFile, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      new Function('require', 'module', 'exports', activationCode)((name) => {
        if (name === 'summermail-exports') return {
          ComponentRegistry: { register: (component, options) => registrations.push({ component, options }) },
          WorkspaceStore: { Location: { ThreadList: { Toolbar: 'thread-toolbar' }, MessageList: { Toolbar: 'message-toolbar' } } },
        };
        if (name === './thread-list-controls') return { default: Controls };
        if (name === './thread-permalink-handler') return { activate() {} };
        return { default: function Placeholder() {} };
      }, activation, activation.exports);
      activation.exports.activate();
      const controlModes = registrations.find((entry) => entry.component === Controls).options.modes;
      const SearchBar = load(
        path.join(root, 'app/internal_packages/thread-search/lib/thread-search-bar.tsx')
      ).ThreadSearchBar;
      document.body.innerHTML = '<main><div id="search"></div><div id="controls"></div></main>';
      document.body.style.margin = '24px';
      document.querySelector('main').style.cssText = 'display:flex;align-items:center;gap:8px';
      ReactDOM.render(React.createElement(Controls), document.querySelector('#controls'));
      const button = document.querySelector('[aria-haspopup="menu"]');
      button.click();
      const folderChoices = menu.filter((item) => item.type === 'radio').map((item) => item.label);
      menu.find((item) => item.label === 'Size').click();
      button.click();
      const sizeDefault = state.sortAscending();
      menu.find((item) => item.label === 'Smallest first').click();
      const sizeAscending = state.sortAscending();
      isSearch = true;
      perspectiveListeners.forEach((fn) => fn());
      button.click();
      const hasRelevance = menu.some((item) => item.label === 'Relevance');
      menu.find((item) => item.label === 'Relevance').click();
      button.click();
      const relevanceDirectionsDisabled = menu
        .filter((item) => 'enabled' in item)
        .every((item) => item.enabled === false);
      const search = ReactDOM.render(
        React.createElement(SearchBar, {
          query: '',
          isSearching: false,
          resultCount: null,
          perspective: exportsStub.FocusedPerspectiveStore.current(),
        }),
        document.querySelector('#search')
      );
      let insertion = 0;
      search._fieldEl.insertionIndex = () => insertion;
      insertion = 'from:old'.length;
      const oldRequest = search._generateSuggestionsForQuery('from:old');
      insertion = 'from:new'.length;
      const newRequest = search._generateSuggestionsForQuery('from:new');
      pendingContacts.new([{ email: 'new@example.com', name: 'New' }]);
      await newRequest;
      pendingContacts.old([{ email: 'old@example.com', name: 'Old' }]);
      await oldRequest;
      const latestSuggestion = search.state.suggestions[0].term;
      const util = load(
        path.join(root, 'app/internal_packages/thread-search/lib/search-bar-util.ts')
      );
      const sizeToken = util.getCurrentTokenAndTerm('larger:10M', 10);
      state.setSortField('size');
      return {
        controlModes,
        sortButtonText: button.textContent,
        folderChoices,
        sizeDefault,
        sizeAscending,
        hasRelevance,
        relevanceDirectionsDisabled,
        latestSuggestion,
        sizeToken,
      };
    }, root);
    assert.deepEqual(result.controlModes, ['split', 'list', 'splitVertical']);
    assert.equal(result.sortButtonText, 'Sort by Size');
    assert.deepEqual(result.folderChoices.slice(0, 4), ['Date', 'Size', 'Sender', 'Subject']);
    assert.equal(result.sizeDefault, false);
    assert.equal(result.sizeAscending, true);
    assert.equal(result.hasRelevance, true);
    assert.equal(result.relevanceDirectionsDisabled, true);
    assert.equal(result.latestSuggestion, '"new@example.com"');
    assert.equal(result.sizeToken.token, 'larger');
    assert.equal(result.sizeToken.term, '10m');
    const less = require(path.join(root, 'app/node_modules/less'));
    for (const theme of ['ui-light', 'ui-dark']) {
      const source = `@import '${path.join(root, 'app/internal_packages', theme, 'styles/ui-variables.less').replace(/\\/g, '/')}';
@import '${path.join(root, 'app/internal_packages/thread-list/styles/unthreaded.less').replace(/\\/g, '/')}';
@import '${path.join(root, 'app/internal_packages/thread-search/styles/thread-search-bar.less').replace(/\\/g, '/')}';
body { background: @background-primary; color: @text-color; font: 14px 'Segoe UI', sans-serif; }
.thread-search-bar { width: 340px; }`;
      const css = (
        await less.render(source, {
          paths: [
            path.join(root, 'app/internal_packages', theme, 'styles'),
            path.join(root, 'app/static/style'),
            path.join(root, 'app/static/style/base'),
          ],
        })
      ).css;
      await page.evaluate((css) => {
        let style = document.querySelector('#test-theme');
        if (!style) {
          style = document.createElement('style');
          style.id = 'test-theme';
          document.head.appendChild(style);
        }
        style.textContent = css;
      }, css);
      // Let the existing 120ms color transition settle before checking contrast.
      await page.waitForFunction(
        (expected) => {
          const style = getComputedStyle(document.querySelector('.thread-list-control'));
          return style.color === expected && style.backgroundColor === 'rgba(0, 0, 0, 0)';
        },
        theme === 'ui-dark' ? 'rgba(238, 241, 255, 0.78)' : 'rgba(23, 26, 47, 0.78)'
      );
      if (process.env.SEARCH_SCREENSHOTS)
        await page.screenshot({ path: path.join(root, '.tmp', `search-controls-${theme}.png`) });
    }
    console.log(
      'PASS: real controls open sort choices, apply size/direction, expose relevance, retain the newest autocomplete response, recognize size tokens, and use the correct light/dark colors.'
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
