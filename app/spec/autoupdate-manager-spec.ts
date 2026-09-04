import AutoUpdateManager from '../src/browser/autoupdate-manager';

describe('AutoUpdateManager', function () {
  beforeEach(function () {
    this.originalUpdateHost = process.env.SUMMERMAIL_UPDATE_HOST;
    process.env.SUMMERMAIL_UPDATE_HOST = 'updates.summermail.invalid';
    this.summermailIdentityId = null;
    this.specMode = true;
    this.config = {
      set: jasmine.createSpy('config.set'),
      get: (key) => {
        if (key === 'identity.id') {
          return this.summermailIdentityId;
        }
        if (key === 'env') {
          return 'production';
        }
      },
      onDidChange: (key, callback) => {
        return callback();
      },
    };
  });

  afterEach(function () {
    if (this.originalUpdateHost === undefined) {
      delete process.env.SUMMERMAIL_UPDATE_HOST;
    } else {
      process.env.SUMMERMAIL_UPDATE_HOST = this.originalUpdateHost;
    }
  });

  describe('with attached commit version', () =>
    it('correctly sets the feedURL', function () {
      const m = new AutoUpdateManager('3.222.1-abc', this.config, this.specMode);
      spyOn(m, 'setupAutoUpdater');
      expect(m.feedURL).toEqual(
        'https://updates.summermail.invalid/check/' +
          process.platform +
          '/' +
          process.arch +
          '/3.222.1-abc/anonymous/stable'
      );
    }));

  describe('with no attached commit', () =>
    it('correctly sets the feedURL', function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      spyOn(m, 'setupAutoUpdater');
      expect(m.feedURL).toEqual(
        'https://updates.summermail.invalid/check/' +
          process.platform +
          '/' +
          process.arch +
          '/3.222.1/anonymous/stable'
      );
    }));

  describe('when an update identity is already set', () =>
    it('should send it and not save any changes', function () {
      this.summermailIdentityId = 'test-summermail-id';
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      expect(m.feedURL).toEqual(
        'https://updates.summermail.invalid/check/' +
          process.platform +
          '/' +
          process.arch +
          '/3.222.1/test-summermail-id/stable'
      );
    }));

  describe('when an update identity is added', () =>
    it('should update the feed URL', function () {
      const m = new AutoUpdateManager('3.222.1', this.config, this.specMode);
      spyOn(m, 'setupAutoUpdater');
      expect(m.feedURL.includes('anonymous')).toEqual(true);
      this.summermailIdentityId = 'test-summermail-id';
      m.updateFeedURL();
      expect(m.feedURL.includes(this.summermailIdentityId)).toEqual(true);
    }));
});
