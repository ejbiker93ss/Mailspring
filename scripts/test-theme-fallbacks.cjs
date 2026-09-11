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
    const themeIndex = path.join(root, 'app/internal_packages', theme, 'styles/index.less');
    const themeCss = fs.existsSync(themeIndex)
      ? (await less.render(fs.readFileSync(themeIndex, 'utf8'), {filename:themeIndex,paths})).css
      : '';
    compiled.push({theme,css,base,themeCss});
    console.log(`PASS compile: ${theme} / ${files.length} stylesheets`);
    if (themeCss) console.log(`PASS theme entrypoint: ${theme}`);
  }
  if (!process.argv.includes('--visual')) return;
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:800}});
    for (const {theme,css,base,themeCss} of compiled) {
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

      if (themeCss && (theme === 'ui-light' || theme === 'ui-dark')) {
        await page.setContent(`<style>${base}\n${css[css.length - 1]}\n${themeCss}
          *{box-sizing:border-box} body{padding:0;margin:0;overflow:hidden}
          .app-tab-bar{height:44px;display:flex;align-items:end;padding:0 18px;gap:4px}
          .app-tab{height:34px;padding:9px 18px}.app-tab.active{background:var(--fm-surface-raised)}
          summermail-workspace{display:grid;grid-template-columns:224px 348px 1fr;height:756px;overflow:hidden}
          .column-RootSidebar{padding:16px 12px}.brand{font-size:19px;font-weight:700;margin:0 8px 18px}
          .btn.item-compose{height:38px;line-height:36px;width:100%;margin-bottom:18px}
          .outline-view .heading{margin:16px 8px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.58}
          .outline-view .item{height:32px;padding:7px 10px;margin:2px 0}.item-count-box{float:right}
          .thread-column{min-height:0;overflow:hidden;border-right:1px solid var(--fm-border);background:var(--fm-surface)}
          .sheet-toolbar{height:48px;padding:8px 12px;display:flex;gap:8px;align-items:center}.search{flex:1;padding:8px 10px;background:var(--fm-surface-raised);border:1px solid var(--fm-border-strong);border-radius:7px}
          .thread-list.thread-list-narrow{height:708px;overflow:hidden}.thread-list.thread-list-narrow .list-rows{height:auto!important;padding:5px}#theme-fixture.thread-list.thread-list-narrow .list-item{position:relative;height:76px!important;min-height:76px;padding:10px 12px!important;margin:3px 1px!important}
          .participants{font-weight:650}.subject{margin-top:5px}.snippet{margin-top:4px;opacity:.7}.timestamp{float:right;font-size:12px;opacity:.6}
          .message-list{padding:16px 18px}.message-item-wrap{margin:0!important}.message-item-white-wrap{padding:26px 30px;min-height:620px}.message-header{border-bottom:1px solid var(--fm-border)}
          .message-title{font-size:25px;font-weight:720;letter-spacing:-.025em;margin:0 0 18px}.sender{font-weight:650}.meta{color:@text-color-subtle;margin-top:4px}.message-body{max-width:68ch;font-size:15px;line-height:1.6;margin-top:28px}.message-body p{margin:0 0 18px}.reply{margin-top:38px;padding:13px 15px;border:1px solid var(--fm-border-strong);border-radius:10px;color:@text-color-subtle}
        </style><div class="app-tab-bar"><div class="app-tab active">Mail</div><div class="app-tab">Calendar</div><div class="app-tab">Contacts</div></div>
        <summermail-workspace><aside class="column-RootSidebar"><div class="brand">SummerMail</div><button class="btn item-compose">Compose</button><div class="account-sidebar"><div class="outline-view"><div class="heading">Favorites</div><div class="item selected">Inbox <span class="item-count-box">12</span></div><div class="item">Sent</div><div class="item">Drafts <span class="item-count-box">3</span></div><div class="heading">Folders</div><div class="item">Projects</div><div class="item">Receipts</div><div class="item">Travel</div></div></div></aside>
        <section class="thread-column"><div class="sheet-toolbar"><div class="search">Search mail</div><button class="btn">Unread</button></div><div id="theme-fixture" class="thread-list thread-list-narrow"><div class="list-rows"><div class="list-item unread selected"><span class="timestamp">9:35 AM</span><div class="participants">Paul from Sentry</div><div class="subject">Reminder: Create a project</div><div class="snippet">A few resources that might help you get started…</div></div><div class="list-item unread"><span class="timestamp">8:42 AM</span><div class="participants">Affinity Team</div><div class="subject">Welcome to Affinity</div><div class="snippet">Your all-in-one creative workspace…</div></div><div class="list-item"><span class="timestamp">Yesterday</span><div class="participants">Google Security</div><div class="subject">Critical security alert</div><div class="snippet">Review your recent sign-in activity.</div></div><div class="list-item"><span class="timestamp">Sep 3</span><div class="participants">Hostinger</div><div class="subject">Don't get locked out</div><div class="snippet">Add a recovery email in just a few steps.</div></div></div></div></section>
        <main id="message-list" class="message-list"><div class="message-item-wrap"><article class="message-item-white-wrap"><header class="message-header"><h1 class="message-title">Reminder: Create a project</h1><div class="sender">Paul from Sentry</div><div class="meta">to me · Today at 9:35 AM</div></header><div class="message-body"><p>Hey there,</p><p>Welcome to Sentry. Here are a few resources that might help you get your project set up and your team moving.</p><p><a href="#">Open the setup guide</a> or reply if you have any questions.</p><p>— Paul</p><div class="reply">Write a reply…</div></div></article></div></main></summermail-workspace>`);
        await page.screenshot({path:path.join(root, `.tmp-theme-workspace-${theme}.png`)});
        console.log(`PASS workspace visual: ${theme}`);
      }
    }
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exit(1);});
