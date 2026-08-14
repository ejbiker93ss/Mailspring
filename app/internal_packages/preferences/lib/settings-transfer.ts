import { AccountStore, CategoryStore } from 'mailspring-exports';

export const SETTINGS_BUNDLE_FORMAT = 'flashmail-settings';
export const SETTINGS_BUNDLE_VERSION = 1;
const BLOCKED_ROOT_KEYS = new Set(['accounts', 'credentials', 'identity']);
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_KEY = /(password|secret|token|credential|privatekey|accesskey)/i;

const isPlainObject = (value: any) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const sanitizedSettings = (value: any, depth = 0): any => {
  if (Array.isArray(value)) return value.map((entry) => sanitizedSettings(entry, depth + 1));
  if (!isPlainObject(value)) return value;

  return Object.keys(value).reduce((result, key) => {
    if (
      BLOCKED_OBJECT_KEYS.has(key) ||
      (depth === 0 && BLOCKED_ROOT_KEYS.has(key)) ||
      SENSITIVE_KEY.test(key)
    )
      return result;
    result[key] = sanitizedSettings(value[key], depth + 1);
    return result;
  }, {});
};

const categoriesForAccount = (accountId: string): any[] =>
  CategoryStore.categories(accountId) || [];

const folderPath = (folder: any) => folder.path || folder.displayName;

export const createSettingsBundle = (rawSettings: any) => {
  const settings = sanitizedSettings(rawSettings);
  const favorites = settings?.core?.workspace?.favoriteFoldersByAccount || {};
  const folderOrder = settings?.core?.workspace?.sidebarFolderOrderByAccount || {};
  const accountOrder = settings?.core?.workspace?.sidebarAccountOrder || [];
  const collapsedAccounts = settings?.core?.workspace?.sidebarCollapsedAccountIds || [];
  const kanban = settings?.['mail-kanban']?.lanesByAccount || {};
  const accountsById = new Map(AccountStore.accounts().map((account) => [account.id, account]));

  const folderPreferences = AccountStore.accounts().map((account) => {
    const folders = categoriesForAccount(account.id);
    const byId = new Map<string, any>(folders.map((folder) => [folder.id, folder]));
    const favoriteIds = Object.prototype.hasOwnProperty.call(favorites, account.id)
      ? favorites[account.id]
      : folders.filter((folder) => folder.role === 'inbox').map((folder) => folder.id);
    return {
      accountEmail: account.emailAddress,
      favorites: favoriteIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(folderPath),
      kanban: (kanban[account.id] || [])
        .map((lane) => byId.get(lane.folderId))
        .filter(Boolean)
        .map(folderPath),
      order: (folderOrder[account.id] || []).map((id) => {
        const folder = byId.get(id);
        return folder ? { type: 'folder', path: folderPath(folder) } : { type: 'item', id };
      }),
    };
  });

  return {
    format: SETTINGS_BUNDLE_FORMAT,
    version: SETTINGS_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    folderPreferences,
    sidebarPreferences: {
      accountOrder: accountOrder.map((id) => accountsById.get(id)?.emailAddress).filter(Boolean),
      collapsedAccounts: collapsedAccounts
        .map((id) => accountsById.get(id)?.emailAddress)
        .filter(Boolean),
    },
  };
};

const mergeObjects = (base: any, incoming: any): any => {
  if (!isPlainObject(base) || !isPlainObject(incoming)) return incoming;
  const merged = { ...base };
  Object.keys(incoming).forEach((key) => {
    merged[key] = mergeObjects(base[key], incoming[key]);
  });
  return merged;
};

const applyPortableFolderPreferences = (
  settings: any,
  folderPreferences: any[],
  sidebarPreferences?: any
) => {
  if (!Array.isArray(folderPreferences)) return settings;
  const favorites = { ...(settings?.core?.workspace?.favoriteFoldersByAccount || {}) };
  const folderOrder = { ...(settings?.core?.workspace?.sidebarFolderOrderByAccount || {}) };
  const kanban = { ...(settings?.['mail-kanban']?.lanesByAccount || {}) };

  folderPreferences.forEach((entry) => {
    if (!isPlainObject(entry)) return;
    const account = AccountStore.accounts().find(
      (candidate) =>
        String(candidate.emailAddress || '').toLocaleLowerCase() ===
        String(entry.accountEmail || '').toLocaleLowerCase()
    );
    if (!account) return;
    const folders = categoriesForAccount(account.id);
    const byPath = new Map<string, any>(folders.map((folder) => [folderPath(folder), folder]));
    favorites[account.id] = (Array.isArray(entry.favorites) ? entry.favorites : [])
      .map((path) => byPath.get(path)?.id)
      .filter(Boolean);
    kanban[account.id] = (Array.isArray(entry.kanban) ? entry.kanban : [])
      .map((path, index) => byPath.get(path)?.id)
      .filter(Boolean)
      .map((folderId, index) => ({
        id: `lane-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        folderId,
      }));
    folderOrder[account.id] = (Array.isArray(entry.order) ? entry.order : [])
      .map((orderedItem) => {
        if (!isPlainObject(orderedItem)) return null;
        if (orderedItem.type === 'folder') return byPath.get(orderedItem.path)?.id;
        if (orderedItem.type === 'item' && typeof orderedItem.id === 'string') {
          return orderedItem.id;
        }
        return null;
      })
      .filter(Boolean);
  });

  const next = mergeObjects({}, settings);
  next.core = next.core || {};
  next.core.workspace = next.core.workspace || {};
  next.core.workspace.favoriteFoldersByAccount = favorites;
  next.core.workspace.sidebarFolderOrderByAccount = folderOrder;
  if (isPlainObject(sidebarPreferences)) {
    const accountByEmail = new Map(
      AccountStore.accounts().map((account) => [
        String(account.emailAddress || '').toLocaleLowerCase(),
        account.id,
      ])
    );
    const resolveAccountEmails = (values: any) =>
      (Array.isArray(values) ? values : [])
        .map((email) => accountByEmail.get(String(email || '').toLocaleLowerCase()))
        .filter(Boolean);
    next.core.workspace.sidebarAccountOrder = resolveAccountEmails(sidebarPreferences.accountOrder);
    next.core.workspace.sidebarCollapsedAccountIds = resolveAccountEmails(
      sidebarPreferences.collapsedAccounts
    );
  }
  next['mail-kanban'] = next['mail-kanban'] || {};
  next['mail-kanban'].lanesByAccount = kanban;
  return next;
};

export const settingsFromBundle = (bundle: any, currentSettings: any) => {
  if (!isPlainObject(bundle) || bundle.format !== SETTINGS_BUNDLE_FORMAT) {
    throw new Error('This is not a FlashMail settings export.');
  }
  if (bundle.version !== SETTINGS_BUNDLE_VERSION || !isPlainObject(bundle.settings)) {
    throw new Error('This settings export uses an unsupported version.');
  }
  const imported = sanitizedSettings(bundle.settings);
  return applyPortableFolderPreferences(
    mergeObjects(currentSettings, imported),
    bundle.folderPreferences,
    bundle.sidebarPreferences
  );
};
