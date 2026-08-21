import { calcEventColors } from '../lib/core/calendar-helpers';

describe('calendar event colors', () => {
  it('uses opaque theme-native surfaces and foreground-led text', () => {
    spyOn(AppEnv.config, 'get').andCallFake((key) =>
      key === 'calendar.colors.test-calendar' ? 'rgba(0, 145, 220, 0.15)' : undefined
    );

    const colors = calcEventColors('test-calendar');

    expect(colors.band).toContain('rgb(0, 145, 220)');
    expect(colors.background).toContain('var(--calendar-event-surface)');
    expect(colors.text).toContain('var(--calendar-event-text)');
    expect(colors.background).not.toContain('rgba');
  });
});
