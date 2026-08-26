import SheetContainer from '../src/sheet-container';
import { WorkspaceStore } from 'mailspring-exports';

describe('SheetContainer hot window transitions', () => {
  it('re-renders with the composer window type before showing a reused hot window', () => {
    let onWindowPropsReceived: () => void;
    const dispose = jasmine.createSpy('dispose');

    spyOn(AppEnv, 'getWindowType').andReturn('emptyWindow');
    spyOn(AppEnv, 'onWindowPropsReceived').andCallFake((callback) => {
      onWindowPropsReceived = callback as () => void;
      return { dispose };
    });
    spyOn(WorkspaceStore, 'listen').andReturn(() => {});

    const container = new SheetContainer({});
    spyOn(container, 'setState');
    container.componentDidMount();

    (AppEnv.getWindowType as jasmine.Spy).andReturn('composer');
    onWindowPropsReceived();

    const nextState = (container.setState as jasmine.Spy).mostRecentCall.args[0];
    expect(nextState.windowType).toBe('composer');

    container.componentWillUnmount();
    expect(dispose).toHaveBeenCalled();
  });
});
