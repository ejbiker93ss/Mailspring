/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Ported legacy plugin module; compiled by the first-party TypeScript pipeline.
import { MessageViewExtension } from 'mailspring-exports';

/* ===================== Helpers ===================== */

const outputHTMLFor = function (doc, initialHTML) {
  if (!doc || !doc.body) return initialHTML;

  if (/<\s?head\s?>/i.test(initialHTML) || /<\s?body[\s>]/i.test(initialHTML)) {
    return doc.children[0].innerHTML;
  }
  return doc.body.innerHTML;
};

const isElement = function (n) {
  return n && n.nodeType === 1;
};

const getTrimmedText = function (el) {
  if (!el) return '';
  return String(el.textContent || '')
    .replace(/\u00a0/g, ' ')
    .trim();
};

const hasClass = function (el, cls) {
  if (!el || !el.classList) return false;
  return el.classList.contains(cls);
};

const isInsideGmailQuote = function (el) {
  if (!el || !el.closest) return false;
  return !!el.closest('blockquote.gmail_quote, blockquote.gmail_quote *');
};

const findNextElementSibling = function (el) {
  if (!el) return null;
  let n = el.nextSibling;
  while (n && n.nodeType !== 1) n = n.nextSibling;
  return n;
};

/* ===================== Core wrapper (blockquotes only) ===================== */

const wrapSiblingsFromHere = function (doc, startEl) {
  if (!startEl || !startEl.parentNode) return false;

  const parent = startEl.parentNode;
  if (isElement(parent) && hasClass(parent, 'gmail_quote')) return false;

  const wrapper = doc.createElement('blockquote');
  wrapper.className = 'gmail_quote';

  parent.insertBefore(wrapper, startEl);

  let node = startEl;
  while (node) {
    const next = node.nextSibling;
    wrapper.appendChild(node);
    node = next;
  }
  return true;
};

/* ================= Froala attribution normalization ================= */

const normalizeFroalaQuoteAttribution = function (doc) {
  const nodes = doc.querySelectorAll('[fr-original-class="gmail_quote_attribution"]');
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].classList.add('gmail_quote_attribution');
  }
};

const wrapAttributionBlockquotePairs = function (doc) {
  const attrs = doc.querySelectorAll(
    '.gmail_quote_attribution, [fr-original-class="gmail_quote_attribution"]'
  );

  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];

    if (!hasClass(a, 'gmail_quote_attribution')) a.classList.add('gmail_quote_attribution');
    if (a.closest && a.closest('blockquote.gmail_quote')) continue;

    const next = findNextElementSibling(a);
    if (!next) continue;

    if (next.tagName && next.tagName.toLowerCase() === 'blockquote') {
      next.classList.add('gmail_quote');
    }
  }
};

/* ================= Separators (Outlook / dashed) ================= */

const forceWrapAtSeparators = function (doc) {
  const hr = doc.querySelector('hr#previousmessagehr');
  if (hr && !isInsideGmailQuote(hr)) {
    wrapSiblingsFromHere(doc, hr);
    return;
  }

  const candidates = doc.querySelectorAll('div, p, pre, span, font');
  for (let i = 0; i < candidates.length; i++) {
    const t = getTrimmedText(candidates[i]);
    if (/^-{15,}$/.test(t) && !isInsideGmailQuote(candidates[i])) {
      wrapSiblingsFromHere(doc, candidates[i]);
      return;
    }
  }
};

/* ================= Freshdesk / Freshservice ================= */

const extractSeparatorAttribution = function (bq) {
  let separatorSpan = null;
  let child = bq.firstChild;
  while (child) {
    if (
      isElement(child) &&
      (child.tagName || '').toLowerCase() === 'span' &&
      hasClass(child, 'separator')
    ) {
      separatorSpan = child;
      break;
    }
    child = child.nextSibling;
  }

  if (!separatorSpan) return null;

  let attrText = '';

  child = bq.firstChild;
  while (child && child !== separatorSpan) {
    if (child.nodeType === 3) {
      attrText += child.textContent || '';
    }
    child = child.nextSibling;
  }

  let spanChild = separatorSpan.firstChild;
  const contentNodes = [];
  let reachedContent = false;

  while (spanChild) {
    const nextSpanChild = spanChild.nextSibling;

    if (!reachedContent) {
      if (spanChild.nodeType === 3) {
        attrText += spanChild.textContent || '';
      } else if (isElement(spanChild)) {
        const tag = (spanChild.tagName || '').toLowerCase();
        if (
          tag === 'div' ||
          tag === 'p' ||
          tag === 'table' ||
          tag === 'blockquote' ||
          tag === 'hr' ||
          tag === 'ul' ||
          tag === 'ol' ||
          tag === 'pre'
        ) {
          reachedContent = true;
          contentNodes.push(spanChild);
        } else {
          attrText += spanChild.textContent || '';
        }
      }
    } else {
      if (
        isElement(spanChild) ||
        (spanChild.nodeType === 3 && (spanChild.textContent || '').trim())
      ) {
        contentNodes.push(spanChild);
      }
    }

    spanChild = nextSpanChild;
  }

  attrText = attrText
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/^On\s.+wrote:\s*$/i.test(attrText)) return null;

  const insertBefore = separatorSpan.nextSibling;
  for (let c = 0; c < contentNodes.length; c++) {
    bq.insertBefore(contentNodes[c], insertBefore);
  }

  while (bq.firstChild && bq.firstChild !== separatorSpan) {
    bq.removeChild(bq.firstChild);
  }
  if (separatorSpan.parentNode) {
    separatorSpan.parentNode.removeChild(separatorSpan);
  }

  while (bq.firstChild) {
    const x = bq.firstChild;
    if (x.nodeType === 3 && !String(x.textContent || '').trim()) {
      bq.removeChild(x);
      continue;
    }
    if (isElement(x) && (x.tagName || '').toLowerCase() === 'br') {
      bq.removeChild(x);
      continue;
    }
    break;
  }

  return attrText;
};

const stripLeadingOnWroteLine = function (bq) {
  const raw = (bq.innerText || bq.textContent || '').replace(/\u00a0/g, ' ');
  const lines = String(raw)
    .split('\n')
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  if (!lines.length) return null;

  const firstLine = lines[0];
  if (!/^On\s.+wrote:/i.test(firstLine)) return null;

  let removed = 0;
  while (bq.firstChild && removed < 60) {
    const fc = bq.firstChild;

    if (isElement(fc) && (fc.tagName || '').toLowerCase() === 'br') {
      bq.removeChild(fc);
      removed++;
      break;
    }

    bq.removeChild(fc);
    removed++;
  }

  while (bq.firstChild) {
    const x = bq.firstChild;
    if (x.nodeType === 3 && !String(x.textContent || '').trim()) {
      bq.removeChild(x);
      continue;
    }
    if (isElement(x) && (x.tagName || '').toLowerCase() === 'br') {
      bq.removeChild(x);
      continue;
    }
    break;
  }

  return firstLine;
};

const normalizeFreshdeskQuotes = function (doc) {
  const candidates = doc.querySelectorAll('.freshdesk_quote');

  let target = null;
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (el.getAttribute && el.getAttribute('data-msse-wrapped') === '1') continue;
    if (isInsideGmailQuote(el)) continue;
    if (el.parentNode && isElement(el.parentNode) && hasClass(el.parentNode, 'freshdesk_quote')) {
      continue;
    }
    target = el;
    break;
  }

  if (!target) return;

  const targetTag = (target.tagName || '').toLowerCase();

  let innerBq;
  if (targetTag === 'blockquote') {
    innerBq = target;
  } else {
    innerBq =
      target.querySelector('blockquote.freshdesk_quote') || target.querySelector('blockquote');
  }

  if (!innerBq) return;

  let attrText = extractSeparatorAttribution(innerBq);

  if (!attrText) {
    attrText = stripLeadingOnWroteLine(innerBq);
  }

  const parent = target.parentNode;
  if (!parent) return;

  // Convert blockquote → div
  const contentDiv = doc.createElement('div');
  contentDiv.className = 'freshdesk_quote_content';
  while (innerBq.firstChild) {
    contentDiv.appendChild(innerBq.firstChild);
  }

  if (targetTag !== 'blockquote') {
    parent.insertBefore(contentDiv, target);
    parent.removeChild(target);
  } else {
    parent.insertBefore(contentDiv, target);
    parent.removeChild(target);
  }

  // Insert attribution
  const attrEl = doc.createElement('div');
  attrEl.className = 'gmail_quote_attribution';
  attrEl.textContent = attrText || 'quoted text';
  contentDiv.parentNode.insertBefore(attrEl, contentDiv);

  // Wrap from attribution onward
  wrapSiblingsFromHere(doc, attrEl);
};

/* ================= Entry ================= */

export default class LongDashQuotedReplyExtension extends MessageViewExtension {
  static formatMessageBody({ message }) {
    if (!message) return;
    if (message.plaintext) return;

    const html = message.body;
    if (typeof html !== 'string' || !html.length) return;

    let doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (error) {
      AppEnv.reportError(error);
      return;
    }

    if (!doc || !doc.body) return;

    normalizeFroalaQuoteAttribution(doc);
    wrapAttributionBlockquotePairs(doc);

    normalizeFreshdeskQuotes(doc);

    forceWrapAtSeparators(doc);

    message.body = outputHTMLFor(doc, html);
  }
}
