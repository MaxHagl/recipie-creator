describe('auth', () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalHash = process.env.APP_PASSWORD_HASH;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-abc123';
    process.env.APP_PASSWORD_HASH = '$2a$12$fakehash';
    jest.resetModules();
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
    process.env.APP_PASSWORD_HASH = originalHash;
  });

  it('computeSessionToken returns a 64-char hex string', async () => {
    const { computeSessionToken } = await import('@/lib/auth');
    const token = computeSessionToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('isValidSessionToken returns true for correct token', async () => {
    const { computeSessionToken, isValidSessionToken } = await import('@/lib/auth');
    const token = computeSessionToken();
    expect(isValidSessionToken(token)).toBe(true);
  });

  it('isValidSessionToken returns false for wrong token', async () => {
    const { isValidSessionToken } = await import('@/lib/auth');
    expect(isValidSessionToken('deadbeef'.repeat(8))).toBe(false);
  });

  it('isValidSessionToken returns false for garbage input', async () => {
    const { isValidSessionToken } = await import('@/lib/auth');
    expect(isValidSessionToken('')).toBe(false);
    expect(isValidSessionToken('not-hex')).toBe(false);
  });
});
