import {
  buildSelectionQuoteHTML,
  buildSelectionQuotePlainText,
  insertSelectionQuote,
} from '../../src/services/selection-quote';

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
});
