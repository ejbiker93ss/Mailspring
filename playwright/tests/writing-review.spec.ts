import { test, expect } from '@playwright/test';
import { launchApp, closeApp, executeInRenderer } from '../helpers';

test('writing review selects corrections and resolves each send decision once', async () => {
  const { electronApp, mainWindow, configDir } = await launchApp();
  try {
    const openReview = async (error = false) => {
      await executeInRenderer(electronApp, `(() => {
        const ReactDOM = require('react-dom');
        const View = require(AppEnv.getLoadSettings().resourcePath + '/internal_packages/composer/lib/composer-view').default;
        const host = document.createElement('div'); host.id='writing-review-test'; document.body.appendChild(host);
        window.reviewTest = {text:'helo world. this are fine.', decisions:[], replacements:0};
        const instance = {_mounted:true, editor:{current:{
          getEditableText:()=>window.reviewTest.text,
          replaceEditableText:text=>{window.reviewTest.replacements++;window.reviewTest.text=text;}
        }}};
        require('summermail-exports').Actions.closePopover = () => {ReactDOM.unmountComponentAtNode(host); host.remove();};
        View.prototype._reviewBeforeSending.call(instance,
          card=>ReactDOM.render(card,host), window.reviewTest.text,
          ${error ? 'undefined' : JSON.stringify('Hello world. This is fine.')},
          ${error ? JSON.stringify('Test network failure') : 'undefined'}
        ).then(result=>window.reviewTest.decisions.push(result));
      })()`);
    };
    await openReview();
    const review = mainWindow.locator('#writing-review-test');
    const boxes = review.getByRole('checkbox');
    expect(await boxes.count()).toBeGreaterThan(1);
    await boxes.first().uncheck();
    await review.screenshot({path:'playwright/writing-review.png'});
    await review.getByRole('button', {name:'Apply and Send', exact:true}).click();
    await expect.poll(() => executeInRenderer(electronApp, 'window.reviewTest.decisions')).toEqual([true]);
    const applied = await executeInRenderer(electronApp, 'window.reviewTest');
    expect(applied.text).toBe('helo world. This is fine.');
    expect(applied.replacements).toBe(1);

    await openReview();
    await review.getByRole('button', {name:'Send Anyway', exact:true}).click();
    await expect.poll(() => executeInRenderer(electronApp, 'window.reviewTest.decisions')).toEqual([true]);
    expect(await executeInRenderer(electronApp, 'window.reviewTest.replacements')).toBe(0);

    await openReview();
    await review.getByRole('button', {name:'Cancel', exact:true}).click();
    await expect.poll(() => executeInRenderer(electronApp, 'window.reviewTest.decisions')).toEqual([false]);

    await openReview(true);
    await review.getByRole('button', {name:'Send Anyway', exact:true}).click();
    await expect.poll(() => executeInRenderer(electronApp, 'window.reviewTest.decisions')).toEqual([true]);
  } finally {
    await closeApp(electronApp, configDir);
  }
});
