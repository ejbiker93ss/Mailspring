import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, closeApp } from '../helpers';

let electronApp: ElectronApplication;
let mainWindow: Page;
let configDir: string;

test.beforeAll(async () => {
  ({ electronApp, mainWindow, configDir } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(electronApp, configDir);
});

test('contacts opens as a workspace tab and keeps search interactive', async () => {
  const initialWindowCount = electronApp.windows().length;
  const contactsTab = mainWindow.getByRole('tab', { name: 'Contacts' });

  await expect(contactsTab).toBeVisible();
  await contactsTab.click();

  await expect(contactsTab).toHaveAttribute('aria-selected', 'true');
  await expect(mainWindow.locator('.sheet[data-id="Contacts"]')).toBeVisible();
  await expect(mainWindow.locator('.column-ContactsSidebar')).toBeVisible();
  await expect(mainWindow.locator('.column-ContactsList')).toBeVisible();
  await expect(mainWindow.locator('.column-ContactsDetail')).toBeVisible();
  expect(electronApp.windows().length).toBe(initialWindowCount);

  const search = mainWindow.locator('.contact-search input');
  await search.fill('alex');
  await expect(search).toHaveValue('alex');
  await search.fill('');
});
