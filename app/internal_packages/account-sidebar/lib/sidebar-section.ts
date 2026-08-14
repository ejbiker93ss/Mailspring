/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
import _ from 'underscore';
import {
  Account,
  CategoryStore,
  Label,
  ExtensionRegistry,
  RegExpUtils,
  localized,
} from 'mailspring-exports';

import SidebarItem, {
  configuredFavoriteFolders,
  createCategory,
  favoriteFolderRefKey,
  reorderFavoriteFolders,
} from './sidebar-item';
import * as SidebarActions from './sidebar-actions';
import { ISidebarSection, ISidebarItem } from './types';
import {
  SIDEBAR_REORDER_DRAG_TYPE,
  isAccountCollapsed,
  reorderFolders,
  sortSidebarItems,
  toggleAccountCollapsed,
} from './sidebar-preferences';

function isSectionCollapsed(title: string) {
  if (AppEnv.savedState.sidebarKeysCollapsed[title] !== undefined) {
    return AppEnv.savedState.sidebarKeysCollapsed[title];
  } else {
    return false;
  }
}

function toggleSectionCollapsed(section: ISidebarSection) {
  if (!section) {
    return;
  }
  SidebarActions.setKeyCollapsed(section.title, !isSectionCollapsed(section.title));
}

const readSidebarDrag = (event: any) => {
  try {
    return JSON.parse(event.dataTransfer.getData(SIDEBAR_REORDER_DRAG_TYPE));
  } catch (_err) {
    return null;
  }
};

const makeFoldersReorderable = (
  items: ISidebarItem[],
  accountId: string,
  parentId = 'root',
  reordering = false
): ISidebarItem[] => {
  const siblingIds = items.map((item) => item.id);
  return items.map((item) => {
    const originalOnDrop = item.onDrop;
    const originalShouldAcceptDrop = item.shouldAcceptDrop;
    return {
      ...item,
      draggable: reordering,
      reordering,
      onToggleReorder: () => SidebarActions.setReordering(!reordering),
      children: makeFoldersReorderable(item.children || [], accountId, item.id, reordering),
      onDragStart(_draggedItem, event) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(
          SIDEBAR_REORDER_DRAG_TYPE,
          JSON.stringify({ kind: 'folder', accountId, itemId: item.id, parentId })
        );
      },
      shouldAcceptDrop(targetItem, event) {
        if (event.dataTransfer.types.includes(SIDEBAR_REORDER_DRAG_TYPE)) {
          const payload = readSidebarDrag(event);
          return (
            payload?.kind === 'folder' &&
            payload.accountId === accountId &&
            payload.parentId === parentId &&
            payload.itemId !== item.id
          );
        }
        return originalShouldAcceptDrop ? originalShouldAcceptDrop(targetItem, event) : false;
      },
      onDrop(targetItem, event) {
        if (event.dataTransfer.types.includes(SIDEBAR_REORDER_DRAG_TYPE)) {
          const payload = readSidebarDrag(event);
          if (
            payload?.kind === 'folder' &&
            payload.accountId === accountId &&
            payload.parentId === parentId
          ) {
            const bounds = event.currentTarget.getBoundingClientRect();
            reorderFolders(
              accountId,
              payload.itemId,
              item.id,
              siblingIds,
              event.clientY > bounds.top + bounds.height / 2
            );
          }
          return;
        }
        if (originalOnDrop) originalOnDrop(targetItem, event);
      },
    };
  });
};

class SidebarSection {
  static empty(title: string): ISidebarSection {
    return {
      title,
      items: [],
    };
  }

  static standardSectionForAccount(account: Account, reordering = false): ISidebarSection {
    if (!account) {
      throw new Error('standardSectionForAccount: You must pass an account.');
    }

    const cats = CategoryStore.standardCategories(account);
    if (cats.length === 0) {
      return this.empty(account.label);
    }

    const items = _.reject(cats, (cat) => ['drafts', 'snoozed'].includes(cat.role)).map((cat) =>
      SidebarItem.forCategories([cat], { editable: false, deletable: false })
    );

    const unreadItem = SidebarItem.forUnread([account.id]);
    const starredItem = SidebarItem.forStarred([account.id]);
    const draftsItem = SidebarItem.forDrafts([account.id]);

    // Order correctly: Inbox, Unread, Starred, rest... , Drafts
    items.splice(1, 0, unreadItem, starredItem);
    items.push(draftsItem);

    ExtensionRegistry.AccountSidebar.extensions()
      .filter((ext) => ext.sidebarItem != null)
      .forEach((ext) => {
        const { id, name, iconName, perspective, insertAtTop } = ext.sidebarItem([account.id]);
        const item = SidebarItem.forPerspective(id, perspective, { name, iconName });
        if (insertAtTop) {
          return items.splice(3, 0, item);
        } else {
          return items.push(item);
        }
      });

    return {
      title: account.label,
      items: makeFoldersReorderable(
        sortSidebarItems(items, account.id),
        account.id,
        'root',
        reordering
      ),
    };
  }

  static favoritesSectionForAccounts(accounts: Account[], reordering = false): ISidebarSection {
    const items: ISidebarItem[] = [];
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const foldersByAccount = new Map(
      accounts.map((account) => [
        account.id,
        new Map(CategoryStore.categories(account.id).map((category) => [category.id, category])),
      ])
    );

    configuredFavoriteFolders().forEach((favorite) => {
      const account = accountsById.get(favorite.accountId);
      const category: any = foldersByAccount.get(favorite.accountId)?.get(favorite.folderId);
      if (!account || !category) return;
      const item = SidebarItem.forCategories([category], {
        id: `favorite-${account.id}-${category.id}`,
        name:
          accounts.length > 1 ? `${category.displayName} - ${account.label}` : category.displayName,
        editable: false,
        deletable: false,
        exportable: false,
      });
      items.push({
        ...item,
        draggable: reordering,
        reordering,
        onToggleReorder: () => SidebarActions.setReordering(!reordering),
        onDragStart(_draggedItem, event) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(
            SIDEBAR_REORDER_DRAG_TYPE,
            JSON.stringify({ kind: 'favorite', ...favorite })
          );
        },
        shouldAcceptDrop(targetItem, event) {
          if (event.dataTransfer.types.includes(SIDEBAR_REORDER_DRAG_TYPE)) {
            const payload = readSidebarDrag(event);
            return (
              payload?.kind === 'favorite' &&
              favoriteFolderRefKey(payload) !== favoriteFolderRefKey(favorite)
            );
          }
          return item.shouldAcceptDrop(targetItem, event);
        },
        onDrop(targetItem, event) {
          if (event.dataTransfer.types.includes(SIDEBAR_REORDER_DRAG_TYPE)) {
            const payload = readSidebarDrag(event);
            if (payload?.kind === 'favorite') {
              const bounds = event.currentTarget.getBoundingClientRect();
              reorderFavoriteFolders(
                payload,
                favorite,
                event.clientY > bounds.top + bounds.height / 2
              );
            }
            return;
          }
          item.onDrop(targetItem, event);
        },
      });
    });

    return {
      title: localized('Favorites'),
      iconName: 'starred.png',
      items,
    };
  }

  static standardSectionForAccounts(accounts?: Account[], reordering = false): ISidebarSection {
    let children;
    if (!accounts || accounts.length === 0) {
      return this.empty(localized('All Accounts'));
    }
    if (CategoryStore.categories().length === 0) {
      return this.empty(localized('All Accounts'));
    }
    if (accounts.length === 1) {
      return this.standardSectionForAccount(accounts[0], reordering);
    }

    const standardNames = ['inbox', 'important', 'sent', ['archive', 'all'], 'spam', 'trash'];
    const items = [];

    for (const nameOrNames of standardNames) {
      const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
      const categories = CategoryStore.getCategoriesWithRoles(accounts, ...names);
      if (categories.length === 0) {
        continue;
      }

      children = [];
      // eslint-disable-next-line
      accounts.forEach((acc) => {
        const cat = _.first(
          (names as string[])
            .map((name) => CategoryStore.getCategoryByRole(acc, name))
            .filter(Boolean)
        );
        if (!cat) {
          return;
        }
        children.push(
          SidebarItem.forCategories([cat], { name: acc.label, editable: false, deletable: false })
        );
      });

      items.push(
        SidebarItem.forCategories(categories, { children, editable: false, deletable: false })
      );
    }

    const accountIds = accounts.map((a) => a.id);

    const starredItem = SidebarItem.forStarred(accountIds, {
      children: accounts.map((acc) => SidebarItem.forStarred([acc.id], { name: acc.label })),
    });
    const unreadItem = SidebarItem.forUnread(accountIds, {
      children: accounts.map((acc) => SidebarItem.forUnread([acc.id], { name: acc.label })),
    });
    const draftsItem = SidebarItem.forDrafts(accountIds, {
      children: accounts.map((acc) => SidebarItem.forDrafts([acc.id], { name: acc.label })),
    });

    // Order correctly: Inbox, Unread, Starred, rest... , Drafts
    items.splice(1, 0, unreadItem, starredItem);
    items.push(draftsItem);

    ExtensionRegistry.AccountSidebar.extensions()
      .filter((ext) => ext.sidebarItem != null)
      .forEach((ext) => {
        const { id, name, iconName, perspective, insertAtTop } = ext.sidebarItem(accountIds);
        const item = SidebarItem.forPerspective(id, perspective, {
          name,
          iconName,
          children: accounts.map((acc) => {
            const subItem = ext.sidebarItem([acc.id]);
            return SidebarItem.forPerspective(subItem.id + `-${acc.id}`, subItem.perspective, {
              name: acc.label,
              iconName: subItem.iconName,
            });
          }),
        });
        if (insertAtTop) {
          items.splice(3, 0, item);
        } else {
          items.push(item);
        }
      });

    return {
      title: localized('All Accounts'),
      items,
    };
  }

  static forUserCategories(
    account: Account,
    {
      title,
      collapsible,
      accountSection,
      reordering,
    }: {
      title?: string;
      collapsible?: boolean;
      accountSection?: boolean;
      reordering?: boolean;
    } = {}
  ): ISidebarSection {
    let onCollapseToggled;
    if (!account) {
      return;
    }
    // Compute hierarchy for user categories using known "path" separators
    // NOTE: This code uses the fact that userCategoryItems is a sorted set, eg:
    //
    // Inbox
    // Inbox.FolderA
    // Inbox.FolderA.FolderB
    // Inbox.FolderB
    //
    const items: ISidebarItem[] = [];
    const seenItems: { [key: string]: ISidebarItem } = {};
    for (const category of CategoryStore.userCategories(account)) {
      // https://regex101.com/r/jK8cC2/1
      let item: ISidebarItem = null;
      const re = RegExpUtils.subcategorySplitRegex();
      const itemKey = category.displayName.replace(re, '/');

      let parent = null;
      let parentKey: string = null;
      const parentComponents = itemKey.split('/');
      for (let i = parentComponents.length; i >= 1; i--) {
        parentKey = parentComponents.slice(0, i).join('/');
        parent = seenItems[parentKey];
        if (parent) {
          break;
        }
      }

      if (parent) {
        const itemDisplayName = category.displayName.substr(parentKey.length + 1);
        item = SidebarItem.forCategories([category], { name: itemDisplayName });
        parent.children.push(item);
      } else {
        item = SidebarItem.forCategories([category]);
        items.push(item);
      }
      seenItems[itemKey] = item;
    }

    const inbox = CategoryStore.getInboxCategory(account);
    let iconName = null;

    if (inbox && inbox.constructor === Label) {
      if (title == null) {
        title = localized('Labels');
      }
      iconName = 'tag.png';
    } else {
      if (title == null) {
        title = localized('Folders');
      }
      iconName = 'folder.png';
    }
    const collapsed = accountSection ? isAccountCollapsed(account.id) : isSectionCollapsed(title);
    if (collapsible) {
      onCollapseToggled = accountSection
        ? () => toggleAccountCollapsed(account.id)
        : toggleSectionCollapsed;
    }
    const titleColor = account.color;

    return {
      title,
      iconName,
      items: makeFoldersReorderable(
        sortSidebarItems(items, account.id),
        account.id,
        'root',
        reordering
      ),
      accountId: account.id,
      collapsed,
      titleColor,
      onCollapseToggled,
      onItemCreated(displayName: string) {
        createCategory(account.id, displayName);
      },
    };
  }

  static completeSectionForAccount(account: Account, reordering = false): ISidebarSection {
    const standard = this.standardSectionForAccount(account, reordering);
    const user = this.forUserCategories(account, {
      title: account.label,
      collapsible: true,
      accountSection: true,
      reordering,
    });

    return {
      ...user,
      title: account.label,
      iconName: 'folder.png',
      items: makeFoldersReorderable(
        sortSidebarItems([...standard.items, ...user.items], account.id),
        account.id,
        'root',
        reordering
      ),
    };
  }
}

export default SidebarSection;
