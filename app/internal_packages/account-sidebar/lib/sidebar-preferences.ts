import { Account } from 'mailspring-exports';

export const SIDEBAR_ACCOUNT_ORDER_CONFIG_KEY = 'core.workspace.sidebarAccountOrder';
export const SIDEBAR_FOLDER_ORDER_CONFIG_KEY = 'core.workspace.sidebarFolderOrderByAccount';
export const SIDEBAR_COLLAPSED_ACCOUNTS_CONFIG_KEY = 'core.workspace.sidebarCollapsedAccountIds';
export const SIDEBAR_REORDER_DRAG_TYPE = 'application/x-flashmail-sidebar-reorder';

type FolderOrderByAccount = Record<string, string[]>;

const configuredArray = (key: string): string[] => {
  const value = AppEnv.config.get(key);
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
};

const rankById = (order: string[]) => new Map(order.map((id, index) => [id, index]));

export const sortedAccounts = (accounts: Account[]): Account[] => {
  const rank = rankById(configuredArray(SIDEBAR_ACCOUNT_ORDER_CONFIG_KEY));
  return accounts
    .map((account, originalIndex) => ({ account, originalIndex }))
    .sort((left, right) => {
      const leftRank = rank.has(left.account.id)
        ? rank.get(left.account.id)
        : Number.MAX_SAFE_INTEGER;
      const rightRank = rank.has(right.account.id)
        ? rank.get(right.account.id)
        : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.originalIndex - right.originalIndex;
    })
    .map(({ account }) => account);
};

export const folderOrderForAccount = (accountId: string): string[] => {
  const value: FolderOrderByAccount = AppEnv.config.get(SIDEBAR_FOLDER_ORDER_CONFIG_KEY) || {};
  return Array.isArray(value[accountId]) ? value[accountId] : [];
};

export const sortSidebarItems = <T extends { id: string; children?: T[] }>(
  items: T[],
  accountId: string
): T[] => {
  const rank = rankById(folderOrderForAccount(accountId));
  const sortLevel = (entries: T[]): T[] =>
    entries
      .map((entry, originalIndex) => ({
        entry: {
          ...entry,
          children: entry.children ? sortLevel(entry.children) : entry.children,
        },
        originalIndex,
      }))
      .sort((left, right) => {
        const leftRank = rank.has(left.entry.id)
          ? rank.get(left.entry.id)
          : Number.MAX_SAFE_INTEGER;
        const rightRank = rank.has(right.entry.id)
          ? rank.get(right.entry.id)
          : Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.originalIndex - right.originalIndex;
      })
      .map(({ entry }) => entry);
  return sortLevel(items);
};

const moveRelative = (
  current: string[],
  sourceId: string,
  targetId: string,
  visibleIds: string[],
  placeAfter: boolean
) => {
  const complete = [...current];
  visibleIds.forEach((id) => {
    if (!complete.includes(id)) complete.push(id);
  });
  const withoutSource = complete.filter((id) => id !== sourceId);
  const targetIndex = withoutSource.indexOf(targetId);
  const insertIndex = targetIndex < 0 ? withoutSource.length : targetIndex + (placeAfter ? 1 : 0);
  withoutSource.splice(insertIndex, 0, sourceId);
  return withoutSource;
};

export const reorderAccounts = (
  sourceId: string,
  targetId: string,
  accounts: Account[],
  placeAfter = false
) => {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const current = configuredArray(SIDEBAR_ACCOUNT_ORDER_CONFIG_KEY);
  AppEnv.config.set(
    SIDEBAR_ACCOUNT_ORDER_CONFIG_KEY,
    moveRelative(
      current,
      sourceId,
      targetId,
      accounts.map((account) => account.id),
      placeAfter
    )
  );
};

export const reorderFolders = (
  accountId: string,
  sourceId: string,
  targetId: string,
  siblingIds: string[],
  placeAfter = false
) => {
  if (!accountId || !sourceId || !targetId || sourceId === targetId) return;
  const all: FolderOrderByAccount = AppEnv.config.get(SIDEBAR_FOLDER_ORDER_CONFIG_KEY) || {};
  AppEnv.config.set(SIDEBAR_FOLDER_ORDER_CONFIG_KEY, {
    ...all,
    [accountId]: moveRelative(
      folderOrderForAccount(accountId),
      sourceId,
      targetId,
      siblingIds,
      placeAfter
    ),
  });
};

export const isAccountCollapsed = (accountId: string) =>
  configuredArray(SIDEBAR_COLLAPSED_ACCOUNTS_CONFIG_KEY).includes(accountId);

export const toggleAccountCollapsed = (accountId: string) => {
  const current = configuredArray(SIDEBAR_COLLAPSED_ACCOUNTS_CONFIG_KEY);
  AppEnv.config.set(
    SIDEBAR_COLLAPSED_ACCOUNTS_CONFIG_KEY,
    current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
  );
};

export const resetSidebarArrangement = () => {
  AppEnv.config.set(SIDEBAR_ACCOUNT_ORDER_CONFIG_KEY, []);
  AppEnv.config.set(SIDEBAR_FOLDER_ORDER_CONFIG_KEY, {});
  AppEnv.config.set(SIDEBAR_COLLAPSED_ACCOUNTS_CONFIG_KEY, []);
};
