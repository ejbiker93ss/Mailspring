import { act, cleanup, render } from '@testing-library/react';
import { Actions, React } from 'summermail-exports';

import ActivitySidebar from '../lib/sidebar/activity-sidebar';

describe('ActivitySidebar sync status notices', () => {
  beforeEach(() => {
    jasmine.clock().install();
  });

  afterEach(() => {
    cleanup();
    jasmine.clock().uninstall();
  });

  it('shows one polite status line and clears it automatically', async () => {
    const { container } = render(<ActivitySidebar />);

    await act(async () => {
      Actions.showSyncStatusNotice('Move not confirmed — checking folders…');
    });

    const notice = container.querySelector('.sync-status-notice');
    expect(notice.textContent).toContain('Move not confirmed');
    expect(notice.getAttribute('role')).toBe('status');

    await act(async () => {
      jasmine.clock().tick(8001);
    });
    expect(container.querySelector('.sync-status-notice')).toBeNull();
  });
});
