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

  const isValid = await bcrypt.compare(password, process.env.APP_PASSWORD_HASH!);

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = computeSessionToken();
  const response = NextResponse.json({ success: true });

  response.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  return response;
}
