export type MailSortField = 'relevance' | 'date' | 'size' | 'from' | 'subject';

export const MAIL_SORT_FIELDS: MailSortField[] = ['relevance', 'date', 'size', 'from', 'subject'];

// Full RFC822 bytes supplied by the provider. Missing sizes stay unknown rather
// than being estimated from hydrated attachments or the displayed HTML body.
export function messageSizeSQL(alias: string) {
  return `CASE WHEN CAST(json_extract(${alias}.data, '$.size') AS INTEGER) > 0 THEN CAST(json_extract(${alias}.data, '$.size') AS INTEGER) END`;
}

export function threadSortSQL(field: MailSortField, ascending: boolean, isSent = false) {
  const direction = ascending ? 'ASC' : 'DESC';
  const date = `\`Thread\`.\`${isSent ? 'lastMessageSentTimestamp' : 'lastMessageReceivedTimestamp'}\``;
  const tieBreak = `${date} DESC, \`Thread\`.id ASC`;
  switch (field) {
    case 'size': {
      // A conversation is ordered by its largest message, not the sum of copies.
      const size = `(SELECT MAX(${messageSizeSQL('sortMessage')}) FROM \`Message\` sortMessage WHERE sortMessage.threadId = \`Thread\`.id)`;
      return `(${size} IS NULL) ASC, ${size} ${direction}, ${tieBreak}`;
    }
    case 'from': {
      const sender = `(SELECT lower(COALESCE(NULLIF(json_extract(sortMessage.data, '$.from[0].name'), ''), json_extract(sortMessage.data, '$.from[0].email'), '')) FROM \`Message\` sortMessage WHERE sortMessage.threadId = \`Thread\`.id ORDER BY sortMessage.date DESC, sortMessage.id ASC LIMIT 1)`;
      return `${sender} COLLATE NOCASE ${direction}, ${tieBreak}`;
    }
    case 'subject':
      return `\`Thread\`.subject COLLATE NOCASE ${direction}, ${tieBreak}`;
    default:
      return `${date} ${direction}, \`Thread\`.id ASC`;
  }
}
