export interface MailAssistantEmailReference {
  id: string;
  subject?: string;
}

const THREAD_LINK_PREFIX = '#mailspring-thread=';

export function mailAssistantThreadHref(threadId: string) {
  return `${THREAD_LINK_PREFIX}${encodeURIComponent(threadId)}`;
}

export function threadIdFromMailAssistantHref(href: string | null | undefined) {
  if (!href || !href.startsWith(THREAD_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(THREAD_LINK_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeMarkdownLabel(value: string) {
  return Array.from(value)
    .map((character) =>
      character === '\\' || character === '[' || character === ']' ? `\\${character}` : character
    )
    .join('');
}

/**
 * Makes exact subject references clickable even if the model forgot to add the
 * link requested by its prompt. Existing Markdown links and code are left
 * untouched so URLs, quoted source, and code samples cannot be corrupted.
 */
export function linkMailAssistantEmailReferences(
  markdown: string,
  references: MailAssistantEmailReference[]
) {
  const unique = new Map<string, MailAssistantEmailReference>();
  references.forEach((reference) => {
    const subject = (reference.subject || '').trim();
    if (reference.id && subject && subject !== '(no subject)' && !unique.has(subject)) {
      unique.set(subject, reference);
    }
  });
  const sorted = Array.from(unique.entries()).sort(([a], [b]) => b.length - a.length);
  if (!sorted.length) return markdown;

  const protectedMarkdown = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]]*\]\([^)]+\))/g;
  const protectedMarkdownPart = /^(?:```[\s\S]*```|`[^`\n]*`|\[[^\]]*\]\([^)]+\))$/;
  const subjectPattern = new RegExp(
    sorted.map(([subject]) => escapeRegExp(subject)).join('|'),
    'g'
  );
  return markdown
    .split(protectedMarkdown)
    .map((part) => {
      if (!part || protectedMarkdownPart.test(part)) return part;
      return part.replace(subjectPattern, (subject) => {
        const reference = unique.get(subject);
        return reference
          ? `[${escapeMarkdownLabel(subject)}](${mailAssistantThreadHref(reference.id)})`
          : subject;
      });
    })
    .join('');
}
