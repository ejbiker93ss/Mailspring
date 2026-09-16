import {
  clipboardFileIsImage,
  clipboardFileMetadata,
  extensionForClipboardImageContents,
  extensionForClipboardMimeType,
  waitForFilePasteOperations,
} from '../../src/components/composer-editor/composer-editor';

describe('ComposerEditor pasted images', () => {
  it('preserves extensions for common clipboard image types', () => {
    expect(extensionForClipboardMimeType('image/png')).toBe('.png');
    expect(extensionForClipboardMimeType('image/x-png')).toBe('.png');
    expect(extensionForClipboardMimeType('image/jpeg')).toBe('.jpg');
    expect(extensionForClipboardMimeType('IMAGE/JPEG')).toBe('.jpg');
    expect(extensionForClipboardMimeType('image/pjpeg')).toBe('.jpg');
    expect(extensionForClipboardMimeType('image/gif')).toBe('.gif');
    expect(extensionForClipboardMimeType('image/bmp')).toBe('.bmp');
    expect(extensionForClipboardMimeType('image/webp')).toBe('.webp');
    expect(extensionForClipboardMimeType('image/tiff')).toBe('.tiff');
  });

  it('does not invent an extension for an unknown clipboard type', () => {
    expect(extensionForClipboardMimeType('application/octet-stream')).toBe('');
  });

  it('recognizes clipboard images independently of their temporary filename', () => {
    expect(clipboardFileIsImage('image/png')).toBe(true);
    expect(clipboardFileIsImage('image/x-png')).toBe(true);
    expect(clipboardFileIsImage('', 'clipboard-image.webp')).toBe(true);
    expect(clipboardFileIsImage('application/pdf', 'document.pdf')).toBe(false);
  });

  it('recognizes an extensionless Windows clipboard bitmap from its bytes', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(extensionForClipboardImageContents(pngBytes.buffer)).toBe('.png');
    expect(clipboardFileIsImage('', '', pngBytes.buffer)).toBe(true);
    expect(clipboardFileMetadata('', '', pngBytes.buffer)).toEqual({
      extension: '.png',
      inline: true,
    });

    const nonImageBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(extensionForClipboardImageContents(nonImageBytes.buffer)).toBe('');
    expect(clipboardFileIsImage('', '', nonImageBytes.buffer)).toBe(false);
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
