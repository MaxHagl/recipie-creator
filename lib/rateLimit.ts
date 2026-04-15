interface Entry {
  count: number;
  windowStart: number;
}

const store = new Map<string, Entry>();
const MAX = 5;
const WINDOW_MS = 60_000;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= MAX) return false;

  entry.count++;
  return true;
}

/** Only exported for tests — do not call in application code. */
export function _resetStoreForTesting(): void {
  store.clear();
}
