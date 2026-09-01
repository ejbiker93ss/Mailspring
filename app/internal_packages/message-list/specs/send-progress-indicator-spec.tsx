import React from 'react';
import { cleanup, render } from '@testing-library/react';

import SendProgressIndicator, { remainingSendSeconds } from '../lib/send-progress-indicator';

describe('SendProgressIndicator', function () {
  afterEach(cleanup);

  it('shows the number of seconds remaining before delivery starts', function () {
    const startedAt = Date.now();
    const { container } = render(
      <SendProgressIndicator
        sendState={{ phase: 'countdown', startedAt, sendAt: startedAt + 5000 }}
      />
    );

    expect(remainingSendSeconds(startedAt + 5000, startedAt)).toBe(5);
    expect(container.querySelector('.send-progress-seconds').textContent).toBe('5');
    expect(container.querySelector('.send-progress-indicator').getAttribute('aria-label')).toBe(
      'Sending in 5s'
    );
  });

  it('switches to the delivery spinner when sending begins', function () {
    const { container } = render(<SendProgressIndicator sendState={{ phase: 'sending' }} />);

    expect(container.querySelector('.send-progress-spinner-arc')).not.toBeNull();
    expect(container.querySelector('.send-progress-indicator').getAttribute('aria-label')).toBe(
      'Sending message'
    );
  });
});
