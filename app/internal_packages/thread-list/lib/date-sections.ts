import { localized } from 'summermail-exports';

export type DateSectionKey = 'today' | 'yesterday' | 'last-week' | 'last-month' | 'older';
export type CollapsedDateSections = Partial<Record<DateSectionKey, boolean>>;

export function shouldShowDateSections(perspective?: { searchQuery?: string } | null): boolean {
  return !perspective?.searchQuery;
}

export const DATE_SECTION_ORDER: DateSectionKey[] = [
  'today',
  'yesterday',
  'last-week',
  'last-month',
  'older',
];

export function dateSectionFor(
  value: Date | string | number | null | undefined,
  now = new Date()
): DateSectionKey {
  const date = new Date(value);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 7);
  const lastMonth = new Date(today);
  lastMonth.setDate(today.getDate() - 30);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= lastWeek) return 'last-week';
  if (date >= lastMonth) return 'last-month';
  return 'older';
}

export function dateSectionLabel(key: DateSectionKey): string {
  const labels: Record<DateSectionKey, string> = {
    today: localized('Today'),
    yesterday: localized('Yesterday'),
    'last-week': localized('Last Week'),
    'last-month': localized('Last Month'),
    older: localized('Older'),
  };
  return labels[key];
}

export function toggleDateSection(
  collapsedSections: CollapsedDateSections,
  key: DateSectionKey
): CollapsedDateSections {
  return { ...collapsedSections, [key]: !collapsedSections[key] };
}
