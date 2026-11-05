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
    const less = require(path.join(root, 'app/node_modules/less'));
    const compileTheme = async (theme) => (await less.render(`
@import '${path.join(root, 'app/internal_packages', theme, 'styles/ui-variables.less').replace(/\\/g, '/')}';
@import '${path.join(root, 'app/static/style/workspace.less').replace(/\\/g, '/')}';
@import '${path.join(root, 'app/internal_packages/thread-list/styles/unthreaded.less').replace(/\\/g, '/')}';
@import '${path.join(root, 'app/internal_packages/thread-search/styles/thread-search-bar.less').replace(/\\/g, '/')}';
@import '${path.join(root, 'app/static/style/modern-ui.less').replace(/\\/g, '/')}';
body { background: @background-primary; color: @text-color; font: 14px 'Segoe UI', sans-serif; }
.toolbar-ThreadList { width: 340px; left: 192px; }
.item-container { align-items: center; }
.test-message { height: 78px; padding: 8px; margin: 0 4px 4px; border: 1px solid @border-color-divider; border-radius: 10px; box-sizing: border-box; }
`, { paths: [
      path.join(root, 'app/internal_packages', theme, 'styles'),
      path.join(root, 'app/static/style'), path.join(root, 'app/static/style/base'),
    ] })).css;
    await page.addStyleTag({ content: await compileTheme('ui-light') });
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
      const RetinaImg = ({ className, onClick, onMouseDown }) => React.createElement('span', { className, onClick, onMouseDown });
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
      const SearchBar = load(
        path.join(root, 'app/internal_packages/thread-search/lib/thread-search-bar.tsx')
      ).ThreadSearchBar;
      document.body.className = 'platform-win32 window-type-default';
      document.body.innerHTML = '<div class="layout-mode-test" style="position:relative;display:flex;flex-direction:column;height:100%"><div class="app-tab-bar">Mail</div><header class="sheet-toolbar"><div class="sheet-toolbar-container" data-id="Threads" style="position:absolute;width:100%;height:100%"><main class="toolbar-ThreadList" data-column="1" style="position:absolute;top:0;display:block"><div class="item-container" style="display:flex;position:relative;height:34px;width:100%"><div id="search"></div><div id="controls"></div></div></main></div></header><section style="position:relative;flex:1"><div class="sheet" data-id="Threads" style="position:absolute;width:100%;height:100%"><aside class="column-RootSidebar" style="position:absolute;left:0;width:192px;height:100%">Folders</aside><section class="column-ThreadList" style="position:absolute;left:192px;width:340px;height:100%;overflow:auto"><article class="test-message">First email<p>First subject and preview</p></article><article class="test-message">Second email<p>Second subject and preview</p></article></section><section class="column-MessageList" style="position:absolute;left:532px;right:0;height:100%"><div class="test-detail">Message preview</div></section></div></section></div>';
      document.querySelector('#search').style.cssText = 'display:contents';
      document.body.style.margin = '0';
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
      const insertionIndex = search._fieldEl.insertionIndex;
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
      const parts = load(
        path.join(root, 'app/internal_packages/thread-search/lib/search-query-parts.ts')
      ).searchQueryParts;
      const compound = '(from:"Alice Morgan" OR to:Bob) subject:report larger:10M';
      if (parts(compound).map((part) => part.text).join('') !== compound) throw new Error('Query changed');
      if (parts('"from:alice" report').some((part) => part.token)) throw new Error('Quoted text became a filter');
      const remove = load(
        path.join(root, 'app/internal_packages/thread-search/lib/search-query-parts.ts')
      ).removeSearchQueryPart;
      for (const [query, token, expected] of [
        ['from:Alice AND subject:report', 'from', 'subject:report'],
        ['from:Alice AND subject:report', 'subject', 'from:Alice'],
        ['(from:Alice OR to:Bob) subject:report', 'from', '(to:Bob) subject:report'],
        ['subject:report AND (from:Alice)', 'from', 'subject:report'],
      ]) {
        if (remove(query, parts(query).find((part) => part.token === token)) !== expected)
          throw new Error('Removing a filter broke the boolean query: ' + query);
      }
      exportsStub.ContactStore.searchContacts = async () => [{ name: 'Alice Morgan', email: 'alice@example.com' }];
      exportsStub.ContactStore.topContacts = async () => [];
      search._fieldEl.insertionIndex = insertionIndex;
      const harness = { query: '', submitted: '' };
      const renderSearch = () => ReactDOM.render(React.createElement(SearchBar, {
        query: harness.query, isSearching: false, resultCount: 3444,
        perspective: exportsStub.FocusedPerspectiveStore.current(),
      }), document.querySelector('#search'));
      exportsStub.Actions.searchQueryChanged = (query) => { harness.query = query; renderSearch(); };
      exportsStub.Actions.searchQuerySubmitted = (query) => { harness.query = query; harness.submitted = query; renderSearch(); };
      window.searchPillTest = { harness, setQuery: (query) => { harness.query = query; renderSearch(); } };
      renderSearch();
      state.setSortField('size');
      return {
        folderChoices,
        sizeDefault,
        sizeAscending,
        hasRelevance,
        relevanceDirectionsDisabled,
        latestSuggestion,
        sizeToken,
      };
    }, root);
    assert.deepEqual(result.folderChoices.slice(0, 4), ['Date', 'Size', 'Sender', 'Subject']);
    assert.equal(result.sizeDefault, false);
    assert.equal(result.sizeAscending, true);
    assert.equal(result.hasRelevance, true);
    assert.equal(result.relevanceDirectionsDisabled, true);
    assert.equal(result.latestSuggestion, '"new@example.com"');
    assert.equal(result.sizeToken.token, 'larger');
    assert.equal(result.sizeToken.term, '10m');
    const plain = page.locator('.search-query-text').last();
    const compactWidth = (await page.locator('.thread-search-bar').boundingBox()).width;
    await plain.fill('fr');
    const fromChoice = page.locator('.suggestion').filter({ hasText: /^from:/ }).first();
    await fromChoice.waitFor({ state: 'visible' });
    const fromBox = await fromChoice.boundingBox();
    await page.mouse.click(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    assert.equal(await page.locator('.search-filter-pill select').inputValue(), 'from');
    assert.equal(await page.locator('.search-filter-value').evaluate((el) => el === document.activeElement), true);
    await page.locator('.search-filter-value').fill('Alice Morgan');
    await page.locator('.search-filter-pill select').selectOption('to');
    assert.equal(await page.locator('.search-filter-value').inputValue(), 'Alice Morgan');
    assert.equal(await page.evaluate(() => window.searchPillTest.harness.query), 'to:"Alice Morgan"');
    await page.locator('.search-filter-value').press('Enter');
    assert.equal(await page.evaluate(() => window.searchPillTest.harness.submitted), 'to:"Alice Morgan"');
    await page.waitForFunction(() => document.querySelector('.test-message').getBoundingClientRect().top >= document.querySelector('.thread-search-bar').getBoundingClientRect().bottom);
    assert.equal(await page.locator('.thread-search-bar').evaluate((el) => el.classList.contains('has-query')), true);
    assert.ok((await page.locator('.thread-search-bar').boundingBox()).width > compactWidth,
      'submitted query keeps the wider search field');
    const firstPill = await page.locator('.search-filter-pill').boundingBox();
    await page.mouse.click(firstPill.x + firstPill.width + 20, firstPill.y + firstPill.height / 2);
    await page.keyboard.type('subject:report');
    assert.equal(await page.evaluate(() => window.searchPillTest.harness.query), 'to:"Alice Morgan" subject:report',
      'clicking after a pill appends a separate filter without requiring a leading space');
    assert.equal(await page.locator('.search-filter-pill').count(), 2);
    await page.getByRole('button', { name: 'Remove to filter', exact: true }).click();
    assert.equal(await page.locator('.search-filter-pill').count(), 1);
    assert.equal(await page.locator('.search-filter-value').inputValue(), 'report');
    await page.getByRole('button', { name: 'Remove subject filter', exact: true }).click();
    assert.equal(await page.locator('.search-filter-pill').count(), 0);
    await plain.blur();
    assert.equal((await page.locator('.thread-search-bar').boundingBox()).width, compactWidth,
      'clearing search restores the compact field');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.column-ThreadList')).paddingTop === '34px');
    await plain.fill('from:');
    await page.locator('.search-filter-value').press('Backspace');
    assert.equal(await page.locator('.search-filter-pill').count(), 0);
    await page.evaluate(() => window.searchPillTest.setQuery('from:"Alice Morgan" subject:roadmap '));
    await page.locator('.search-filter-value').first().fill('ali');
    const suggestion = page.locator('.suggestion').filter({ hasText: 'alice@example.com' }).first();
    await suggestion.waitFor({ state: 'visible' });
    const box = await suggestion.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.match(await page.evaluate(() => window.searchPillTest.harness.submitted),
      /from:"alice@example.com" subject:roadmap/);
    await page.evaluate(() => window.searchPillTest.setQuery('from:rod.cf'));
    const searchBox = await page.locator('.thread-search-bar').boundingBox();
    await page.mouse.click(searchBox.x + searchBox.width - 3, searchBox.y + searchBox.height - 2);
    assert.equal(await plain.evaluate((input) => input === document.activeElement), true,
      'empty search-bar background focuses the append input');
    const subjectChoice = page.locator('.suggestion').filter({ hasText: /^subject:/ }).first();
    await subjectChoice.waitFor({ state: 'visible' });
    const subjectBox = await subjectChoice.boundingBox();
    await page.mouse.click(subjectBox.x + subjectBox.width / 2, subjectBox.y + subjectBox.height / 2);
    await page.keyboard.type('Meeting notes');
    assert.equal(await page.evaluate(() => window.searchPillTest.harness.query),
      'from:rod.cf subject:"Meeting notes"');
    await page.locator('.search-filter-value').first().fill('Rod C F');
    await plain.click();
    await page.keyboard.type('to:charlene@example.com');
    assert.equal(await page.locator('.search-filter-pill').count(), 3);
    assert.equal(await page.evaluate(() => window.searchPillTest.harness.query),
      'from:"Rod C F" subject:"Meeting notes" to:charlene@example.com',
      'adding another filter preserves existing editable values and spaces');
    await page.evaluate(() => window.searchPillTest.setQuery('from:rod.cf '));
    await page.getByPlaceholder('Add filter…').click();
    await page.keyboard.type('subject:report');
    assert.equal(await page.evaluate(() => window.searchPillTest.harness.query),
      'from:rod.cf subject:report', 'completed suggestions retain a visible, working add-filter input');
    await page.evaluate(() => window.searchPillTest.setQuery('from:emo.k@msseggs.com subject:"Bump the Meeting" to:charlene@example.com after:2026-10-01 has:attachment '));
    await page.locator('.column-RootSidebar').click({ position: { x: 24, y: 50 } });
    const assertLayout = async () => {
      await page.waitForFunction(() => document.querySelector('.test-message').getBoundingClientRect().top >= document.querySelector('.thread-search-bar').getBoundingClientRect().bottom);
      const layout = await page.evaluate(() => {
        const bar = document.querySelector('.thread-search-bar');
        const rect = bar.getBoundingClientRect();
        const pills = [...bar.querySelectorAll('.search-filter-pill')];
        const editor = bar.querySelector('.search-query-editor');
        return {
          width: rect.width, right: rect.right, top: rect.top, viewport: innerWidth,
          rows: new Set(pills.map((pill) => Math.round(pill.getBoundingClientRect().top))).size,
          hiddenPill: pills.some((pill) => pill.scrollWidth > pill.clientWidth + 1),
          horizontalScroll: editor.scrollWidth > editor.clientWidth + 1,
          clippedValue: [...bar.querySelectorAll('.search-filter-value')].some((input) => input.scrollWidth > input.clientWidth + 1),
          removeButtonsVisible: [...bar.querySelectorAll('.search-filter-remove')].every((button) => {
            const r = button.getBoundingClientRect(); return r.left >= rect.left && r.right <= rect.right && r.bottom <= rect.bottom;
          }),
          controlsRight: document.querySelector('.thread-list-controls').getBoundingClientRect().right,
          countBelowPills: bar.querySelector('.thread-search-result-count').getBoundingClientRect().top >= editor.getBoundingClientRect().bottom,
          firstEmailTop: document.querySelector('.test-message').getBoundingClientRect().top,
          searchBottom: rect.bottom,
          detailTop: document.querySelector('.test-detail').getBoundingClientRect().top,
          sidebarTop: document.querySelector('.column-RootSidebar').getBoundingClientRect().top,
        };
      });
      assert.ok(layout.width > 340, 'query expands beyond the narrow message-list column');
      assert.ok(layout.firstEmailTop >= layout.searchBottom, 'expanded search must not cover the first email: ' + JSON.stringify(layout));
      assert.ok(layout.detailTop >= layout.searchBottom, 'reading pane reserves the same search height');
      assert.equal(layout.sidebarTop, 40, 'search expansion does not move the folder sidebar');
      assert.ok(layout.top >= 0, 'expanded search starts at the toolbar instead of centering offscreen');
      assert.ok(layout.rows > 1, 'additional pills wrap onto visible rows');
      assert.equal(layout.hiddenPill || layout.horizontalScroll || layout.clippedValue, false, JSON.stringify(layout));
      assert.ok(layout.removeButtonsVisible && layout.countBelowPills, JSON.stringify(layout));
      assert.ok(layout.right < layout.viewport && layout.controlsRight <= layout.viewport, JSON.stringify(layout));
    };
    await assertLayout();
    await page.setViewportSize({ width: 776, height: 480 });
    await page.waitForFunction(() => document.querySelector('.thread-list-controls').getBoundingClientRect().right <= innerWidth);
    await assertLayout();
    for (const theme of ['ui-light', 'ui-dark']) {
      const css = await compileTheme(theme);
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
    assert.equal(await page.evaluate((root) => {
      window.require(root + '/app/node_modules/react-dom').unmountComponentAtNode(document.querySelector('#search'));
      return document.querySelector('.layout-mode-test').style.getPropertyValue('--mail-search-toolbar-height');
    }, root), '', 'unmounting search releases its reserved height');
    console.log(
      'PASS: email rows and reading pane stay below wrapped search, sidebar stays fixed, clearing/unmount restore spacing, click-and-type filters, autocomplete, narrow-window resize, and light/dark styles.'
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
