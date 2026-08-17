import {
  buildComposerWordDiff,
  composerTextsMatch,
  maskComposerPrivateText,
  parseComposerToneResult,
} from '../lib/composer-ai-actions';

describe('composer AI writing tools', () => {
  it('parses a structured harsh-tone warning', () => {
    const result = parseComposerToneResult(`\`\`\`json
      {"level":"harsh","headline":"This may sound accusatory","explanation":"The opening assigns blame.","suggestions":["Describe the impact instead."]}
    \`\`\``);

    expect(result.level).toBe('harsh');
    expect(result.headline).toContain('accusatory');
    expect(result.suggestions).toEqual(['Describe the impact instead.']);
  });

  it('masks and restores personal values during grammar rewrites', () => {
    const message: any = {
      from: [{ name: 'Jerian Miller', email: 'jerian@example.com' }],
      to: [],
      cc: [],
      bcc: [],
    };
    const masked = maskComposerPrivateText(
      'Jerian Miller, email jerian@example.com or call +1 (312) 555-0100.',
      [message]
    );

    expect(masked.text).not.toContain('Jerian Miller');
    expect(masked.text).not.toContain('jerian@example.com');
    expect(masked.restore(masked.text)).toBe(
      'Jerian Miller, email jerian@example.com or call +1 (312) 555-0100.'
    );
  });

  it('shows the exact removed and added grammar text', () => {
    const segments = buildComposerWordDiff(
      'Do you think I should make the composer pop up inline?',
      'Do you think I should make the composer popup inline?'
    );

    expect(
      segments.some((segment) => segment.type === 'removed' && segment.text.includes('pop'))
    ).toBe(true);
    expect(
      segments.some((segment) => segment.type === 'added' && segment.text.includes('popup'))
    ).toBe(true);
  });

  it('recognizes an unchanged draft as all good', () => {
    expect(composerTextsMatch('Everything looks good.\n', 'Everything looks good.')).toBe(true);
    expect(composerTextsMatch('Everything look good.', 'Everything looks good.')).toBe(false);
  });
});
