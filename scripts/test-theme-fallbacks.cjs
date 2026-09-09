// Compile real feature styles against old theme variables, without requiring new selectors.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const less = require('../app/node_modules/less');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const files = [
  'app/internal_packages/preferences/styles/preferences-accounts.less',
  'app/internal_packages/contacts/styles/index.less',
  'app/internal_packages/composer/styles/composer.less',
  'app/internal_packages/account-sidebar/styles/app-navigation-menu.less',
  'app/internal_packages/main-calendar/styles/main-calendar.less',
  'app/internal_packages/main-calendar/styles/nylas-calendar.less',
  'app/internal_packages/mail-kanban/styles/mail-kanban.less',
  'app/static/style/modern-ui.less',
];
const themes = ['ui-light', 'ui-dark', 'ui-darkside', 'ui-less-is-more', 'ui-taiga', 'ui-ubuntu'];
async function main() {
  const compiled = [];
  for (const theme of themes) {
    const paths = [path.join(root, 'app/internal_packages', theme, 'styles'), path.join(root, 'app/static/style'), path.join(root, 'app/static/style/base')];
    const css = [];
    for (const file of files) {
      css.push((await less.render(fs.readFileSync(path.join(root, file), 'utf8'), { filename:path.join(root,file), paths })).css);
    }
    const base = (await less.render(`@import 'ui-variables'; @import 'inputs'; @import 'buttons';
      body {background:@background-primary;color:@text-color;font:14px sans-serif;padding:20px;}
      .fixture {display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap;}
      .fixture > .preferences-wrap {width:340px;} .fixture .account-calendar-settings {padding:18px;background:@background-secondary;}
      .contact-detail-column {flex:none;width:260px;} .contact-detail-column .contact-attributes {margin-top:0;}
      .reference-text {color:@text-color;} .reference-link {color:@text-color-link;}
    `, { paths })).css;
    compiled.push({theme,css,base});
    console.log(`PASS compile: ${theme} / ${files.length} stylesheets`);
  }
  if (!process.argv.includes('--visual')) return;
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:800}});
    for (const {theme,css,base} of compiled) {
      // Deliberately exclude modern-ui: legacy themes need only their original tokens.
      await page.setContent(`<style>${base}\n${css.slice(0,-1).join('\n')}</style>
        <h1>${theme} — legacy theme fallbacks</h1><div class="fixture">
        <div class="preferences-wrap"><div class="account-calendar-settings"><h3>Calendar and Contacts</h3><label>WebDAV app password</label><input type="password" value="example"><p class="account-calendar-help">Separate from your mail password.</p><button class="btn btn-emphasis">Save and Sync</button><select><option>SmarterMail</option></select></div></div>
        <div class="composer-ai-review-card"><h2>Spelling &amp; grammar</h2><p>Choose which corrections to keep.</p><div class="composer-ai-corrected-preview composer-ai-change-diff"><label class="composer-ai-correction"><input type="checkbox" checked><del class="diff-removed">helo</del><ins class="diff-added">Hello</ins></label> everyone.</div><div class="composer-ai-review-actions"><button class="btn">Send Anyway</button><button class="btn btn-emphasis">Apply and Send</button></div></div>
        <div class="contact-detail-column"><h3>Contact details</h3><div class="contact-attributes"><div class="contact-attribute"><a href="mailto:example@example.com">example@example.com</a></div></div><textarea class="contact-notes-textarea">Contact notes</textarea></div></div><span class="reference-link">Reference link</span>`);
      const colors = await page.evaluate(() => {
        const style = s => getComputedStyle(document.querySelector(s));
        return {link:style('.contact-attribute a').color, reference:style('.reference-link').color,
          panel:style('.composer-ai-review-card').color, added:style('.diff-added').color,
          notes:style('.contact-notes-textarea').color, input:style('input[type=password]').color};
      });
      assert.strictEqual(colors.link, colors.reference);
      assert.strictEqual(colors.panel, colors.added);
      assert.strictEqual(colors.notes, colors.input);
      await page.screenshot({path:path.join(root, `.tmp-theme-${theme}.png`),fullPage:true});
      console.log(`PASS legacy computed colors: ${theme}`);
    }
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exit(1);});
