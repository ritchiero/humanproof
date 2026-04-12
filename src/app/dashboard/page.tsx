'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { getProjectsByUser, getLogsByUser } from '@/lib/firestore';
import type { Project, CaptureLog } from '@/types';

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [logs, setLogs] = useState<CaptureLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) { router.push('/'); return; }
      setUser(u);
      try {
        const [p, l] = await Promise.all([
          getProjectsByUser(u.uid),
          getLogsByUser(u.uid),
        ]);
        setProjects(p);
        setLogs(l);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    });
    return unsub;
  }, [router]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading dashboard...</div>;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif', background: '#ffffff', minHeight: '100vh', color: '#1a1a1a' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>HumanProof Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>{user?.email}</span>
          <button
            onClick={() => signOut(auth)}
            style={{ padding: '6px 16px', fontSize: 13, background: '#f3f4f6', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 32 }}>
        <div style={{ padding: 20, background: '#f9fafb', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#2563eb' }}>{projects.length}</div>
          <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase' }}>Projects</div>
        </div>
        <div style={{ padding: 20, background: '#f9fafb', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#2563eb' }}>{logs.length}</div>
          <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase' }}>Interactions</div>
        </div>
        <div style={{ padding: 20, background: '#f9fafb', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#2563eb' }}>{logs.filter(l => l.type === 'prompt').length}</div>
          <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase' }}>Human Prompts</div>
        </div>
      </div>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 16 }}>Projects</h2>
      {projects.length === 0 ? (
        <p style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>
          No projects yet. Use the Chrome extension to capture AI interactions, then analyze them to create projects.
        </p>
      ) : (
        projects.map((p) => (
          <div key={p.id} style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8, cursor: 'pointer' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</h3>
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              {p.platforms.join(', ')} · {p.status} · Updated {new Date(p.updatedAt).toLocaleDateString()}
            </p>
          </div>
        ))
      )}

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 32, marginBottom: 16 }}>Recent Logs</h2>
      {logs.length === 0 ? (
        <p style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>No logs captured yet.</p>
      ) : (
        logs.slice(0, 20).map((log) => (
          <div key={log.id} style={{
            padding: 12,
            border: '1px solid #e5e7eb',
            borderLeft: `3px solid ${log.type === 'prompt' ? '#2563eb' : '#16a34a'}`,
            borderRadius: 8,
            marginBottom: 6,
          }}>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
              <strong>{log.platform}</strong> · {log.type} · {new Date(log.timestamp).toLocaleString()} {log.model ? `· ${log.model}` : ''}
            </div>
            <div style={{ fontSize: 12 }}>{log.content?.substring(0, 200)}{(log.content?.length ?? 0) > 200 ? '...' : ''}</div>
          </div>
        ))
      )}
    </div>
  );
}
