import { Actions } from 'summermail-exports';
import EmailFrame, { localPathForInlineImageSource } from '../lib/email-frame';

describe('EmailFrame inline image previews', () => {
  it('resolves a standard Windows file URL', () => {
    expect(localPathForInlineImageSource('file:///C:/Users/example/image.png')).toBe(
      'C:\\Users\\example\\image.png'
    );
  });

  it('retains compatibility with legacy file URLs used in message bodies', () => {
    expect(localPathForInlineImageSource('file://C:%5CUsers%5Cexample%5Cimage.png')).toBe(
      'C:\\Users\\example\\image.png'
    );
  });

  it('does not treat a remote image as a local preview file', () => {
    expect(localPathForInlineImageSource('https://example.com/image.png')).toBeNull();
  });

  it('opens a rendered embedded image in the large preview on double-click', () => {
    const frame = new EmailFrame({} as any);
    const doc = document.implementation.createHTMLDocument();
    const image = doc.createElement('img');
    image.src = 'file:///C:/Users/example/image.png';
    Object.defineProperties(image, {
      complete: { value: true },
      naturalHeight: { value: 600 },
      naturalWidth: { value: 800 },
    });
    doc.body.appendChild(image);
    spyOn(Actions, 'quickPreviewFile');

    frame._attachInlineImagePreviews(doc);
    image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(Actions.quickPreviewFile).toHaveBeenCalledWith('C:\\Users\\example\\image.png');
    expect(image.style.cursor).toBe('zoom-in');
    frame._detachInlineImagePreviews();
  });

  it('ignores tiny tracking images', () => {
    const frame = new EmailFrame({} as any);
    const doc = document.implementation.createHTMLDocument();
    const image = doc.createElement('img');
    image.src = 'file:///C:/Users/example/tracker.png';
    Object.defineProperties(image, {
      complete: { value: true },
      naturalHeight: { value: 1 },
      naturalWidth: { value: 1 },
    });
    doc.body.appendChild(image);
    spyOn(Actions, 'quickPreviewFile');

    frame._attachInlineImagePreviews(doc);
    image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(Actions.quickPreviewFile).not.toHaveBeenCalled();
    frame._detachInlineImagePreviews();
  });
});
