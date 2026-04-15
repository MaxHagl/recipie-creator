jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  computeSessionToken: jest.fn().mockReturnValue('abc123token'),
}));

import bcrypt from 'bcryptjs';
import { POST } from '@/app/api/auth/route';

const mockCompare = bcrypt.compare as jest.Mock;

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth', () => {
  beforeEach(() => {
    process.env.APP_PASSWORD_HASH = '$2a$12$fakehash';
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 200 and sets session cookie on correct password', async () => {
    mockCompare.mockResolvedValue(true);
    const res = await POST(makeRequest({ password: 'correct' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('session=');
  });

  it('returns 401 on wrong password', async () => {
    mockCompare.mockResolvedValue(false);
    const res = await POST(makeRequest({ password: 'wrong' }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it('returns 400 if password field is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
