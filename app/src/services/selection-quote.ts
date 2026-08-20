const escapeHTML = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const normalizedLines = (text: string) => text.replace(/\r\n?/g, '\n').trim().split('\n');

export function buildSelectionQuoteHTML(text: string, author?: string) {
  const attribution = author ? `${escapeHTML(author)} wrote:` : 'Quoted text:';
  const content = normalizedLines(text)
    .map((line) => `<div>${line ? escapeHTML(line) : '<br>'}</div>`)
    .join('');

  // Inline styles are intentional: class-based styling is stripped by many email clients.
  return (
    `<blockquote class="mailspring-selection-quote" ` +
    `style="margin:12px 0;padding:10px 14px;border-left:4px solid #9aa0a6;` +
    `background-color:#f3f4f6;color:#2f3136;font-family:Arial,sans-serif;">` +
    `<div style="margin:0 0 6px;color:#5f6368;font-size:12px;">` +
    `<strong>${attribution}</strong></div>${content}</blockquote>`
  );
}

export function buildSelectionQuotePlainText(text: string, author?: string) {
  const attribution = author ? `${author} wrote:` : 'Quoted text:';
  const quoted = normalizedLines(text)
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
  return `${attribution}\n${quoted}`;
}

export function insertSelectionQuote(body: string, quoteHTML: string) {
  const content = body || '';
  const insertion = `<br>${quoteHTML}<br>`;
  const signatureIndex = content.search(/<signature(?:\s[^>]*)?>/i);

  if (signatureIndex >= 0) {
    return `${content.slice(0, signatureIndex)}${insertion}${content.slice(signatureIndex)}`;
  }

  return `${content}${insertion}`;
}
