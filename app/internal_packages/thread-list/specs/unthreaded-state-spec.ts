import UnthreadedState from '../../../src/flux/stores/unthreaded-state';

describe('UnthreadedState', () => {
  beforeEach(() => {
    (UnthreadedState as any)._selected = null;
    spyOn(UnthreadedState, 'trigger');
  });

  describe('ensureValidSelection', () => {
    it('does not emit a change when an empty selection is already valid', () => {
      UnthreadedState.ensureValidSelection([]);

      expect(UnthreadedState.trigger).not.toHaveBeenCalled();
    });

    it('selects the first item when no selection exists', () => {
      const item = { message: { id: 'message-1' } };

      UnthreadedState.ensureValidSelection([item]);

      expect(UnthreadedState.selected()).toBe(item);
      expect(UnthreadedState.trigger).toHaveBeenCalled();
    });
  });
});
