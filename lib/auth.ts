import crypto from 'crypto';

export function computeSessionToken(): string {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET!)
    .update(process.env.APP_PASSWORD_HASH!)
    .digest('hex');
}

export function isValidSessionToken(token: string): boolean {
  try {
    const expected = computeSessionToken();
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(token, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}
