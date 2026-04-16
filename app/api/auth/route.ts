import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { computeSessionToken } from '@/lib/auth';

export async function POST(request: Request) {
  let password: unknown;

  try {
    const body = await request.json();
    password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  if (!process.env.APP_PASSWORD_HASH) {
    console.error('[auth] Missing APP_PASSWORD_HASH');
    return NextResponse.json({ error: 'Server is not configured' }, { status: 500 });
  }

  let isValid = false;
  try {
    isValid = await bcrypt.compare(password, process.env.APP_PASSWORD_HASH);
  } catch (error) {
    console.error('[auth]', error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  let token: string;
  try {
    token = computeSessionToken();
  } catch (error) {
    console.error('[auth]', error);
    return NextResponse.json({ error: 'Server is not configured' }, { status: 500 });
  }
  const response = NextResponse.json({ success: true });

  response.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  return response;
}
