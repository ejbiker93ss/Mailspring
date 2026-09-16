import { readableForegroundForSystemAccent } from '../src/system-accent-colors';

describe('system accent foreground contrast', () => {
  it('uses light text on a dark Windows accent', () => {
    expect(readableForegroundForSystemAccent('#800080')).toBe('#ffffff');
  });

  it('uses dark text on a light Windows accent', () => {
    expect(readableForegroundForSystemAccent('#91a2ff')).toBe('#000000');
  });

  it('uses the safe light fallback for an invalid accent', () => {
    expect(readableForegroundForSystemAccent('purple')).toBe('#ffffff');
  });
});
