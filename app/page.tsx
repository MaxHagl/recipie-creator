import { cookies } from 'next/headers';
import { AuthPage } from '@/components/AuthPage';
import { AppPage } from '@/components/AppPage';
import { isValidSessionToken } from '@/lib/auth';

export default async function Home() {
  const cookieStore = await cookies();
  const session = cookieStore.get('session');
  const isAuthenticated = !!session && isValidSessionToken(session.value);

  if (!isAuthenticated) return <AuthPage />;

  return <AppPage />;
}
