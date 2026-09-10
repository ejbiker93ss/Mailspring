import { MailboxPerspective } from 'summermail-exports';

export interface ISidebarItem {
  id: string;
  name: string;
  title?: string;
  contextMenuLabel: string;
  count: number;
  iconName: string;
  children: ISidebarItem[];
  perspective: MailboxPerspective;
  selected: boolean;
  collapsed: boolean;
  counterStyle: string;
  onDelete?: () => void;
  onEdited?: (item, name: string) => void;
  onEdit?: (item) => void;
  onExport?: () => void;
  onExportMbox?: () => void;
  onCreateChild?: (item, childName: string) => void;
  onToggleFavorite?: (item) => void;
  onToggleReorder?: (item) => void;
  onCollapseToggled: () => void;
  onDrop: (item, event) => void;
  shouldAcceptDrop: (item, event) => void;
  onSelect: (item) => void;

  deletable?: boolean;
  editable?: boolean;
  exportable?: boolean;
  deleted?: boolean;
  favorite?: boolean;
  reordering?: boolean;
  draggable?: boolean;
  onDragStart?: (item, event) => void;
  onDragEnd?: (item, event) => void;
}

export interface ISidebarSection {
  title: string;
  items: ISidebarItem[];
  iconName?: string;
  collapsed?: boolean;
  titleColor?: string;
  onCollapseToggled?: (section: ISidebarSection) => void;
  onItemCreated?: (displayName) => void;
  onCreateTriggered?: () => void;
  accountId?: string;
  reorderable?: boolean;
  onSectionDragStart?: (event) => void;
  onSectionDragEnd?: (event) => void;
  shouldAcceptSectionDrop?: (event) => boolean;
  onSectionDrop?: (event) => void;
}
