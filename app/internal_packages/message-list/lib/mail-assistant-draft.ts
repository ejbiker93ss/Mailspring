function escapeHTML(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// AI draft bodies are plain text. Convert them into safe block-level HTML so
// Mailspring can use its normal rich composer without interpreting generated
// text as markup.
export function mailAssistantDraftHTML(value: unknown) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  if (!text) return '<div><br></div>';
  return text
    .split('\n')
    .map((line) => (line ? `<div>${escapeHTML(line)}</div>` : '<div><br></div>'))
    .join('');
}
