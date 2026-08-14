import React from 'react';
import DOMPurify from 'dompurify';

const snarkdown = require('snarkdown');

function markdownHTML(markdown: string) {
  return DOMPurify.sanitize(snarkdown(markdown || ''), {
    ALLOWED_TAGS: ['br', 'code', 'em', 'li', 'ol', 'p', 'strong', 'ul'],
    ALLOWED_ATTR: [],
  });
}

export const AiSummaryMarkdown = ({ content }: { content: string }) => (
  <div
    className="ai-summary-markdown"
    dangerouslySetInnerHTML={{ __html: markdownHTML(content) }}
  />
);
