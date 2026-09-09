import { test, expect } from '@playwright/test';
import { launchApp, closeApp, executeInRenderer } from '../helpers';

test('account type changes verify first and retain mail identity and settings', async () => {
  const { electronApp, mainWindow, configDir } = await launchApp();
  try {
    await executeInRenderer(electronApp, `(() => {
      const {AccountStore, Actions, KeyManager, MailsyncProcess} = require('summermail-exports');
      const a = AccountStore.accounts()[0];
      Actions.updateAccount(a.id, {provider: 'imap'});
      window.typeTest = {id:a.id, settings:JSON.parse(JSON.stringify(a.settings)), status:401, relaunches:0, mailChecks:0};
      KeyManager.insertAccountSecrets = async a => {
        const c=a.clone();c.settings.imap_password='test-secret';c.settings.smtp_password='test-secret';return c;
      };
      MailsyncProcess.prototype.test = async function() { window.typeTest.mailChecks++; };
      MailsyncProcess.prototype.kill = () => {};
      AppEnv.mailsyncBridge.forceRelaunchClient = async () => { window.typeTest.relaunches++; };
      const {EventEmitter}=require('events');
      require('https').request = (_url,_options,callback) => {
        const req=new EventEmitter();req.destroy=()=>req.emit('close');
        req.end=()=>setTimeout(()=>{
          const res=new EventEmitter();res.statusCode=window.typeTest.status;callback(res);
          res.emit('data','<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>');
          res.emit('end');req.emit('close');
        },100);
        return req;
      };
      require('electron').ipcRenderer.send('command','application:open-preferences');
    })()`);
    await expect(mainWindow.locator('.preferences-wrap')).toBeVisible();
    await mainWindow.locator('.preferences-tabs .item:has-text("Accounts")').click();
    const control = mainWindow.locator('.account-type-settings');
    await control.getByRole('button', {name:'Change account type…'}).click();
    await control.getByLabel('SmarterMail server').fill('https://mail.example.com');
    await control.getByRole('button', {name:'Verify and Change Type'}).click();
    await expect(control.getByRole('alert')).toContainText('rejected');
    await control.screenshot({path:'playwright/account-type-change.png'});
    expect(await executeInRenderer(electronApp, `require('summermail-exports').AccountStore.accountForId(window.typeTest.id).provider`)).toBe('imap');
    await executeInRenderer(electronApp, 'window.typeTest.status=207');
    await control.getByRole('button', {name:'Verify and Change Type'}).click();
    await expect(control.getByText('SmarterMail', {exact:true})).toBeVisible();
    const state = await executeInRenderer(electronApp, `(() => {
      const a=require('summermail-exports').AccountStore.accountForId(window.typeTest.id);
      return {id:a.id,provider:a.provider,settings:a.settings,before:window.typeTest.settings,relaunches:window.typeTest.relaunches};
    })()`);
    expect(state.provider).toBe('smartermail');
    for (const key of Object.keys(state.before).filter(k => /^(imap_|smtp_|container_folder)/.test(k))) {
      expect(state.settings[key]).toEqual(state.before[key]);
    }
    expect(state.settings.imap_password).toBeUndefined();
    expect(state.settings.carddav_host).toBe('https://mail.example.com/WebDAV/');
    expect(state.relaunches).toBe(1);
    await control.getByRole('button', {name:'Change account type…'}).click();
    await control.getByRole('button', {name:'Verify and Change Type'}).click();
    await expect(control.getByText('IMAP', {exact:true})).toBeVisible();
    expect(await executeInRenderer(electronApp, `require('summermail-exports').AccountStore.accountForId(window.typeTest.id).settings.carddav_host`)).toBe('https://mail.example.com/WebDAV/');
  } finally {
    await closeApp(electronApp, configDir);
  }
});
