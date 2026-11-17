const STORAGE_KEY = 'summermail.search.recent';
const MAX_RECENT_SEARCHES = 8;

// Recent searches are a per-device convenience, so a missing or unreadable
// entry simply starts the list over.
export function recentSearches(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((q) => typeof q === 'string') : [];
  } catch (error) {
    console.warn('Could not read recent searches', error);
    return [];
  }
}

function save(queries: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch (error) {
    console.warn('Could not save recent searches', error);
  }
}

export function rememberSearch(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;
  const others = recentSearches().filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
  save([trimmed, ...others].slice(0, MAX_RECENT_SEARCHES));
}

export function forgetSearch(query: string) {
  save(recentSearches().filter((q) => q !== query));
}
