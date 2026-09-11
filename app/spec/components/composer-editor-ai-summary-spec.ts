import { buildAISummaryHTML } from '../../src/components/composer-editor/composer-editor';
import { convertFromHTML, convertToHTML } from '../../src/components/composer-editor/conversion';

describe('composer AI summary formatting', () => {
  it('creates a compact, clearly labeled summary that survives editor conversion', () => {
    const source = buildAISummaryHTML(
      '**Decision:** use the compact design.\n\n- First point\n- Second point'
    );
    const roundTripped = convertToHTML(convertFromHTML(source));

    expect(roundTripped).toContain('ai-composer-summary');
    expect(roundTripped).toContain('ai-composer-summary-label');
    expect(roundTripped).toContain('AI summary · previous messages');
    expect(roundTripped).toContain('font-size:12px');
    expect(roundTripped).toContain('<ul>');
    const doc = new DOMParser().parseFromString(roundTripped, 'text/html');
    const block = doc.querySelector<HTMLElement>('.ai-composer-summary');
    expect(block.style.border).toContain('1px solid');
    expect(block.style.fontStyle).toBe('italic');
    expect(block.style.backgroundColor).toBe('');
    expect(block.style.color).toBe('');
    expect(doc.querySelector<HTMLElement>('.ai-composer-summary-label').style.fontStyle).toBe(
      'normal'
    );
    const secondPass = convertToHTML(convertFromHTML(roundTripped));
    expect(secondPass).toContain('border:1px solid #999999');
    expect(secondPass).toContain('font-style:italic');
  });

  it('sanitizes generated markdown before inserting it into the composer', () => {
    const html = buildAISummaryHTML('<img src=x onerror="alert(1)"> safe');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toContain('safe');
  });
});
