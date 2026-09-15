import { DraftEditingSession } from '../../src/flux/stores/draft-editing-session';

describe('DraftEditingSession pending attachments', () => {
  it('waits for attachment work before allowing send finalization', async () => {
    const session = Object.create(DraftEditingSession.prototype) as DraftEditingSession;
    session._pendingAttachmentWork = new Set<Promise<void>>();

    let finishAttachment: () => void;
    const attachmentWork = new Promise<void>((resolve) => {
      finishAttachment = resolve;
    });
    session.trackPendingAttachmentWork(attachmentWork);
    expect(session.hasPendingAttachmentWork()).toBe(true);

    let finishedWaiting = false;
    const wait = session.waitForPendingAttachmentWork().then(() => {
      finishedWaiting = true;
    });
    await Promise.resolve();
    expect(finishedWaiting).toBe(false);

    finishAttachment();
    await wait;
    expect(finishedWaiting).toBe(true);
    expect(session.hasPendingAttachmentWork()).toBe(false);
    expect(session._pendingAttachmentWork.size).toBe(0);
  });
});
