import { parseHomeserverInput, parseMatrixLogin, resolveMatrixLogin } from '../lib/matrix-session';

describe('Matrix login parsing', () => {
  it('accepts Matrix user IDs with or without the leading @', () => {
    expect(parseMatrixLogin('@alice:example.com')).toEqual({
      username: 'alice',
      domain: 'example.com',
    });
    expect(parseMatrixLogin('bob:matrix.org')).toEqual({
      username: 'bob',
      domain: 'matrix.org',
    });
  });

  it('rejects incomplete addresses', () => {
    expect(parseMatrixLogin('alice')).toBeNull();
    expect(parseMatrixLogin('https://example.com')).toBeNull();
  });

  it('accepts a username plus homeserver', () => {
    expect(resolveMatrixLogin('alice', 'matrix.example.com')).toEqual({
      username: 'alice',
      domain: 'matrix.example.com',
      homeserverUrl: 'https://matrix.example.com',
    });
    expect(parseHomeserverInput('https://matrix.example.com/')).toBe('https://matrix.example.com');
  });
});
