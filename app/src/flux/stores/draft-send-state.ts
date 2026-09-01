export type DraftSendState =
  | { phase: 'countdown'; startedAt: number; sendAt: number }
  | { phase: 'sending' };

export const draftSendStateForDelay = (delay: number, startedAt = Date.now()): DraftSendState =>
  delay > 0
    ? {
        phase: 'countdown',
        startedAt,
        sendAt: startedAt + delay,
      }
    : { phase: 'sending' };
