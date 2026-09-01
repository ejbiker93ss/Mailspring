import { draftSendStateForDelay } from '../../src/flux/stores/draft-send-state';

describe('draftSendStateForDelay', function () {
  it('returns a timed countdown for the undo-send delay', function () {
    expect(draftSendStateForDelay(5000, 1000)).toEqual({
      phase: 'countdown',
      startedAt: 1000,
      sendAt: 6000,
    });
  });

  it('returns the delivery phase when the real send begins', function () {
    expect(draftSendStateForDelay(0, 1000)).toEqual({ phase: 'sending' });
  });
});
