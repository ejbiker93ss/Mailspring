import {
  extensionForClipboardMimeType,
  waitForFilePasteOperations,
} from '../../src/components/composer-editor/composer-editor';

describe('ComposerEditor pasted images', () => {
  it('preserves extensions for common clipboard image types', () => {
    expect(extensionForClipboardMimeType('image/png')).toBe('.png');
    expect(extensionForClipboardMimeType('image/jpeg')).toBe('.jpg');
    expect(extensionForClipboardMimeType('IMAGE/JPEG')).toBe('.jpg');
    expect(extensionForClipboardMimeType('image/gif')).toBe('.gif');
    expect(extensionForClipboardMimeType('image/bmp')).toBe('.bmp');
    expect(extensionForClipboardMimeType('image/webp')).toBe('.webp');
    expect(extensionForClipboardMimeType('image/tiff')).toBe('.tiff');
  });

  it('does not invent an extension for an unknown clipboard type', () => {
    expect(extensionForClipboardMimeType('application/octet-stream')).toBe('');
  });

  it('waits for every pasted image even when one import fails', async () => {
    let finishSecondImage: () => void;
    const failedImage = Promise.reject(new Error('Unreadable clipboard image'));
    const secondImage = new Promise<void>((resolve) => {
      finishSecondImage = resolve;
    });

    let settled = false;
    const allImages = waitForFilePasteOperations([failedImage, secondImage]).catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishSecondImage();
    await allImages;
    expect(settled).toBe(true);
  });
});
