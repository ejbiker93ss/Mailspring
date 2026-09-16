import { Actions, File } from 'summermail-exports';
import { addFileToComposer } from '../internal_packages/composer/lib/composer-view';

describe('Composer pasted image attachments', () => {
  const image = new File({
    id: 'pasted-image',
    filename: 'Pasted Image.png',
    size: 2048,
    contentType: 'image/png',
    messageId: null,
    contentId: 'inline-content-id',
  });

  it('requests inline creation before inserting a pasted image into rich text', async () => {
    const insertInlineAttachment = jasmine.createSpy('insertInlineAttachment');
    spyOn(Actions, 'addAttachment').andCallFake((options) => {
      expect(options.inline).toBe(true);
      options.onCreated(image);
    });

    await addFileToComposer({
      filePath: 'C:\\Temp\\Pasted Image.png',
      headerMessageId: 'draft-id',
      plaintext: false,
      isMounted: () => true,
      onInlineCreated: insertInlineAttachment,
    });

    expect(insertInlineAttachment).toHaveBeenCalledWith(image);
  });

  it('keeps pasted files as regular attachments in plaintext drafts', async () => {
    const insertInlineAttachment = jasmine.createSpy('insertInlineAttachment');
    spyOn(Actions, 'addAttachment').andCallFake((options) => {
      expect(options.inline).toBe(false);
      options.onCreated(image);
    });

    await addFileToComposer({
      filePath: 'C:\\Temp\\Pasted Image.png',
      headerMessageId: 'draft-id',
      plaintext: true,
      isMounted: () => true,
      onInlineCreated: insertInlineAttachment,
    });

    expect(insertInlineAttachment).not.toHaveBeenCalled();
  });

  it('does not expose non-image files as inline content', async () => {
    const insertInlineAttachment = jasmine.createSpy('insertInlineAttachment');
    const document = new File({
      id: 'pasted-document',
      filename: 'Pasted File.pdf',
      size: 2048,
      contentType: 'application/pdf',
      messageId: null,
      contentId: null,
    });
    spyOn(Actions, 'addAttachment').andCallFake((options) => options.onCreated(document));

    await addFileToComposer({
      filePath: 'C:\\Temp\\Pasted File.pdf',
      headerMessageId: 'draft-id',
      plaintext: false,
      isMounted: () => true,
      onInlineCreated: insertInlineAttachment,
    });

    expect(insertInlineAttachment).not.toHaveBeenCalled();
  });
});
