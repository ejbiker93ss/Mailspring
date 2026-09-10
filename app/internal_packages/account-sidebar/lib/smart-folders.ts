export const SMART_FOLDERS_CONFIG_KEY = 'core.workspace.smartFolders';

export type SmartFolderMatch = 'all' | 'any';
export type SmartFolderScope = 'all' | 'selected';
export type SmartFolderCriterionField =
  | 'anywhere'
  | 'subject'
  | 'from'
  | 'to'
  | 'body'
  | 'folder'
  | 'before'
  | 'after'
  | 'state'
  | 'attachment';

export type SmartFolderCriterion = {
  id: string;
  field: SmartFolderCriterionField;
  value: string;
};

export type SmartFolderDefinition = {
  id: string;
  name: string;
  scope: SmartFolderScope;
  accountIds: string[];
  match: SmartFolderMatch;
  criteria: SmartFolderCriterion[];
  favorite: boolean;
};

const VALID_FIELDS = new Set<SmartFolderCriterionField>([
  'anywhere',
  'subject',
  'from',
  'to',
  'body',
  'folder',
  'before',
  'after',
  'state',
  'attachment',
]);

const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createSmartFolderCriterion = (
  field: SmartFolderCriterionField = 'subject'
): SmartFolderCriterion => ({
  id: id('criterion'),
  field,
  value: '',
});

export const createSmartFolderDefinition = (): SmartFolderDefinition => ({
  id: id('smart-folder'),
  name: '',
  scope: 'all',
  accountIds: [],
  match: 'all',
  criteria: [createSmartFolderCriterion()],
  favorite: false,
});

const normalizeCriterion = (value: any): SmartFolderCriterion | null => {
  if (!value || !VALID_FIELDS.has(value.field)) return null;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : id('criterion'),
    field: value.field,
    value: typeof value.value === 'string' ? value.value : '',
  };
};

const normalizeDefinition = (value: any): SmartFolderDefinition | null => {
  if (!value || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  const criteria = Array.isArray(value.criteria)
    ? value.criteria.map(normalizeCriterion).filter(Boolean)
    : [];
  if (criteria.length === 0) return null;
  return {
    id: value.id,
    name: value.name.trim(),
    scope: value.scope === 'selected' ? 'selected' : 'all',
    accountIds: Array.isArray(value.accountIds)
      ? value.accountIds.filter((accountId) => typeof accountId === 'string')
      : [],
    match: value.match === 'any' ? 'any' : 'all',
    criteria,
    favorite: value.favorite === true,
  };
};

export const configuredSmartFolders = (): SmartFolderDefinition[] => {
  const saved = AppEnv.config.get(SMART_FOLDERS_CONFIG_KEY);
  if (!Array.isArray(saved)) return [];
  return saved.map(normalizeDefinition).filter(Boolean);
};

export const saveSmartFolder = (definition: SmartFolderDefinition) => {
  const normalized = normalizeDefinition(definition);
  if (!normalized) return;
  const current = configuredSmartFolders();
  const existingIndex = current.findIndex((folder) => folder.id === normalized.id);
  if (existingIndex === -1) {
    current.push(normalized);
  } else {
    current[existingIndex] = normalized;
  }
  AppEnv.config.set(SMART_FOLDERS_CONFIG_KEY, current);
};

export const deleteSmartFolder = (smartFolderId: string) => {
  AppEnv.config.set(
    SMART_FOLDERS_CONFIG_KEY,
    configuredSmartFolders().filter((folder) => folder.id !== smartFolderId)
  );
};

export const toggleSmartFolderFavorite = (smartFolderId: string) => {
  const folders = configuredSmartFolders();
  const folder = folders.find((candidate) => candidate.id === smartFolderId);
  if (!folder) return;
  folder.favorite = !folder.favorite;
  AppEnv.config.set(SMART_FOLDERS_CONFIG_KEY, folders);
};

const quote = (value: string) => `"${value.replace(/"/g, '').trim()}"`;

export const smartFolderCriterionQuery = (criterion: SmartFolderCriterion): string => {
  const value = criterion.value.trim();
  switch (criterion.field) {
    case 'attachment':
      return 'has:attachment';
    case 'state':
      return ['read', 'unread', 'starred', 'unstarred'].includes(value) ? `is:${value}` : '';
    case 'anywhere':
      return value ? quote(value) : '';
    case 'folder':
      return value ? `in:${quote(value)}` : '';
    case 'before':
    case 'after':
      return value ? `${criterion.field}:${quote(value)}` : '';
    case 'subject':
    case 'from':
    case 'to':
    case 'body':
      return value ? `${criterion.field}:${quote(value)}` : '';
    default:
      return '';
  }
};

export const smartFolderQuery = (definition: SmartFolderDefinition): string => {
  const clauses = definition.criteria.map(smartFolderCriterionQuery).filter(Boolean);
  if (clauses.length === 0) return '';
  if (definition.match === 'any' && clauses.length > 1) return `(${clauses.join(' OR ')})`;
  return clauses.join(' AND ');
};

export const smartFolderDescription = (definition: SmartFolderDefinition) => {
  const count = definition.criteria.length;
  const ruleLabel = `${count} ${count === 1 ? 'criterion' : 'criteria'}`;
  const accountCount = definition.accountIds.length;
  const scopeLabel =
    definition.scope === 'all'
      ? 'all accounts'
      : `${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}`;
  return `${ruleLabel} · ${scopeLabel}`;
};
