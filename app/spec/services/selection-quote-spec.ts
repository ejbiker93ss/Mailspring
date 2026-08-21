import {
  buildSelectionQuoteHTML,
  buildSelectionQuotePlainText,
  insertSelectionQuote,
} from '../../src/services/selection-quote';
import { convertFromHTML } from '../../src/components/composer-editor/conversion';
import { hasNonTrailingBlockquote } from '../../src/components/composer-editor/base-block-plugins';

describe('selection quotes', () => {
  it('escapes selected content and creates portable inline HTML', () => {
    const html = buildSelectionQuoteHTML('<hello>\nworld & friends', 'Brian & Co.');

    expect(html).toContain('Brian &amp; Co. wrote:');
    expect(html).toContain('&lt;hello&gt;');
    expect(html).toContain('border-left:4px solid #9aa0a6');
    expect(html).not.toContain('<hello>');
  });

  it('inserts the quote immediately before a signature', () => {
    const body = 'My reply<br><signature id="1">Regards</signature><blockquote>Old</blockquote>';
    const result = insertSelectionQuote(body, '<blockquote>Selected</blockquote>');

    expect(result.indexOf('My reply')).toBeLessThan(result.indexOf('Selected'));
    expect(result.indexOf('Selected')).toBeLessThan(result.indexOf('<signature'));
  });

  it('copies a readable plaintext quote shape', () => {
    expect(buildSelectionQuotePlainText('one\ntwo', 'Brian')).toBe('Brian wrote:\n> one\n> two');
  });

  it('does not expand trailing reply history for a selected quote', () => {
    const value = convertFromHTML(buildSelectionQuoteHTML('Readable quote', 'Dustin'));

    expect(hasNonTrailingBlockquote(value)).toBe(false);
  });

  it('keeps trailing reply history collapsed when a selected quote follows it', () => {
    const value = convertFromHTML(
      `<div>Reply</div><blockquote>Previous messages</blockquote>${buildSelectionQuoteHTML(
        'Readable quote',
        'Dustin'
      )}`
    );

    expect(hasNonTrailingBlockquote(value)).toBe(false);
  });
});
