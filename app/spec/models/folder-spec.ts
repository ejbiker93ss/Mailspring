import { Folder } from '../../src/flux/models/folder';

describe('Folder displayName', () => {
  it('labels SmarterMail scheduled folders without changing their server paths', () => {
    for (const suffix of ['8c61c74014d4e679d52c0a6aca4342b', '0123456789ABCDEF0123456789ABCDEF']) {
      const path = `Scheduled${suffix}`;
      const folder = new Folder({ path });
      expect(folder.displayName).toBe('Scheduled');
      expect(folder.path).toBe(path);
    }
  });

  it('preserves normal folder names and near matches', () => {
    for (const path of [
      'Scheduled',
      'Scheduled Meetings',
      'Scheduled123',
      'Scheduled0123456789abcdef0123456789abcdeg',
      'Scheduled0123456789abcdef0123456789abcdef-extra',
      'OtherScheduled0123456789abcdef0123456789abcdef',
    ]) {
      expect(new Folder({ path }).displayName).toBe(path);
    }
  });
});
