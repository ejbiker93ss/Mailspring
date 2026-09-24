import proxyquire from 'proxyquire';

let execFileSpy: jasmine.Spy;
let waitForStatusNotifierHost: (sleep?: (ms: number) => Promise<void>) => Promise<void>;
let statusNotifierWaitBudgetMs: () => number;
const noSleep = () => Promise.resolve();

function loadModule() {
  execFileSpy = jasmine.createSpy('execFile');
  const mod = proxyquire('../src/browser/sni-host', {
    child_process: { execFile: execFileSpy, '@noCallThru': false },
  });
  waitForStatusNotifierHost = mod.waitForStatusNotifierHost;
  statusNotifierWaitBudgetMs = mod.statusNotifierWaitBudgetMs;
}

function respondWith(responses: Array<string | null>) {
  let call = 0;
  execFileSpy.andCallFake(
    (_cmd: string, _args: string[], _opts: any, callback: (err: Error, stdout: string) => void) => {
      const value = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (value === null) callback(new Error('no such name'), '');
      else callback(null, value);
    }
  );
}

const HOST_UP = 'method return\n variant boolean true\n';
const HOST_DOWN = 'method return\n variant boolean false\n';

describe('sni-host', () => {
  let originalSessionType;
  let originalWaylandDisplay;
  let originalPlatform;

  beforeEach(() => {
    originalSessionType = process.env.XDG_SESSION_TYPE;
    originalWaylandDisplay = process.env.WAYLAND_DISPLAY;
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env.XDG_SESSION_TYPE;
    delete process.env.WAYLAND_DISPLAY;
    loadModule();
  });

  afterEach(() => {
    if (originalSessionType === undefined) delete process.env.XDG_SESSION_TYPE;
    else process.env.XDG_SESSION_TYPE = originalSessionType;
    if (originalWaylandDisplay === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('waits until a late-starting host registers', async () => {
    respondWith([HOST_DOWN, HOST_DOWN, HOST_UP]);
    await waitForStatusNotifierHost(noSleep);
    expect(execFileSpy.calls.length).toBe(3);
  });

  it('uses a longer wait budget on Wayland', () => {
    expect(statusNotifierWaitBudgetMs()).toBe(3000);
    process.env.XDG_SESSION_TYPE = 'wayland';
    expect(statusNotifierWaitBudgetMs()).toBe(15000);
  });
});
