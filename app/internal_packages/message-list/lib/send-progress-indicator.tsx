import React from 'react';
import { localized } from 'mailspring-exports';

type SendState = { phase: 'countdown'; startedAt: number; sendAt: number } | { phase: 'sending' };

interface SendProgressIndicatorProps {
  sendState: SendState;
}

interface SendProgressIndicatorState {
  now: number;
}

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export const remainingSendSeconds = (sendAt: number, now: number) =>
  Math.max(0, Math.ceil((sendAt - now) / 1000));

export default class SendProgressIndicator extends React.Component<
  SendProgressIndicatorProps,
  SendProgressIndicatorState
> {
  _timer: ReturnType<typeof setInterval> = null;

  state = { now: Date.now() };

  componentDidMount() {
    this._syncTimer();
  }

  componentDidUpdate(prevProps: SendProgressIndicatorProps) {
    if (prevProps.sendState.phase !== this.props.sendState.phase) {
      this.setState({ now: Date.now() });
      this._syncTimer();
    }
  }

  componentWillUnmount() {
    this._stopTimer();
  }

  _syncTimer() {
    this._stopTimer();
    if (this.props.sendState.phase === 'countdown') {
      const { sendAt } = this.props.sendState;
      this._timer = setInterval(() => {
        const now = Date.now();
        this.setState({ now });
        if (now >= sendAt) this._stopTimer();
      }, 100);
    }
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _renderCountdown(sendState: Extract<SendState, { phase: 'countdown' }>) {
    const seconds = remainingSendSeconds(sendState.sendAt, this.state.now);
    const duration = Math.max(1, sendState.sendAt - sendState.startedAt);
    const remaining = Math.max(0, sendState.sendAt - this.state.now);
    const dashOffset = CIRCUMFERENCE * (1 - Math.min(1, remaining / duration));
    const label = localized('Sending in %@', `${seconds}s`);

    return (
      <span className="send-progress-indicator countdown" role="status" aria-label={label}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle className="send-progress-track" cx="12" cy="12" r={RADIUS} />
          <circle
            className="send-progress-arc"
            cx="12"
            cy="12"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <span className="send-progress-seconds" aria-hidden="true">
          {seconds}
        </span>
      </span>
    );
  }

  _renderSending() {
    const label = localized('Sending message');
    return (
      <span className="send-progress-indicator sending" role="status" aria-label={label}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle className="send-progress-track" cx="12" cy="12" r={RADIUS} />
          <circle className="send-progress-spinner-arc" cx="12" cy="12" r={RADIUS} />
        </svg>
      </span>
    );
  }

  render() {
    return this.props.sendState.phase === 'countdown'
      ? this._renderCountdown(this.props.sendState)
      : this._renderSending();
  }
}
