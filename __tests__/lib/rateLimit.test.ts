import { checkRateLimit, _resetStoreForTesting } from '@/lib/rateLimit';

beforeEach(() => {
  _resetStoreForTesting();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('checkRateLimit', () => {
  it('allows up to 5 requests from the same IP', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('1.2.3.4')).toBe(true);
    }
  });

  it('blocks the 6th request from the same IP', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4');
    expect(checkRateLimit('1.2.3.4')).toBe(false);
  });

  it('does not affect a different IP', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4');
    expect(checkRateLimit('9.9.9.9')).toBe(true);
  });

  it('resets after the window expires', () => {
    jest.useFakeTimers();
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4');
    jest.advanceTimersByTime(61_000);
    expect(checkRateLimit('1.2.3.4')).toBe(true);
    jest.useRealTimers();
  });
});
