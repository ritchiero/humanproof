'use client';

import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) router.push('/dashboard');
      setLoading(false);
    });
    return unsub;
  }, [router]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      router.push('/dashboard');
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;

  return (
    <main style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
    }}>
      <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.5rem', color: '#1a1a1a' }}>HumanProof</h1>
      <p style={{ fontSize: '1.1rem', color: '#6b7280', marginBottom: '2rem', textAlign: 'center', maxWidth: 500 }}>
        AI Authorship Evidence Logger — Automatically document your creative contributions when working with AI.
      </p>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={handleLogin}
          style={{
            padding: '12px 32px', fontSize: '1rem', fontWeight: 600,
            background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          Sign in with Google
        </button>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            padding: '12px 32px', fontSize: '1rem', fontWeight: 600,
            background: '#1a1a1a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          Open Dashboard →
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 16 }}>
        <a href="/dashboard?demo=1" style={{ color: '#2563eb', textDecoration: 'none' }}>Try demo mode</a>
      </p>
    </main>
  );
}
