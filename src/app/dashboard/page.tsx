'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { getProjectsByUser, getLogsByUser, getAllLogs, getAllProjects, saveLog, createProject } from '@/lib/firestore';
import type { Project, CaptureLog } from '@/types';

// ── Colors ──────────────────────────────────────────────────────

const PROJECT_PALETTE = [
  { dot: '#2563eb', bg: '#dbeafe', text: '#1e40af' },
  { dot: '#16a34a', bg: '#dcfce7', text: '#166534' },
  { dot: '#9333ea', bg: '#f3e8ff', text: '#6b21a8' },
  { dot: '#ea580c', bg: '#fff7ed', text: '#9a3412' },
  { dot: '#0891b2', bg: '#ecfeff', text: '#155e75' },
  { dot: '#dc2626', bg: '#fef2f2', text: '#991b1b' },
  { dot: '#ca8a04', bg: '#fefce8', text: '#854d0e' },
];

const GRAY = { dot: '#d1d5db', bg: '#f3f4f6', text: '#9ca3af' };

interface DemoProject {
  name: string;
  description: string;
  logIds: string[];
  platforms: string[];
  startedAt: string;
}

// ── Component ───────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const userRef = useRef<any>(null);
  const [user, setUser] = useState<any>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [logs, setLogs] = useState<CaptureLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<CaptureLog | null>(null);
  const [hoveredLog, setHoveredLog] = useState<string | null>(null);
  const [demoProjects, setDemoProjects] = useState<DemoProject[]>([]);
  const [isDemo, setIsDemo] = useState(false);

  // Fetch live logs from API (extension syncs here)
  const fetchLiveLogs = async () => {
    try {
      const resp = await fetch('/api/logs');
      const data = await resp.json();

      if (data.logs) {
        setLogs((prev) => {
          const existing = new Map(prev.map((l) => [l.id, l]));
          for (const log of data.logs) {
            if (!existing.has(log.id)) {
              existing.set(log.id, log);
              // Persist to Firestore if user is authenticated
              if (userRef.current) {
                saveLog({ ...log, userId: userRef.current.uid }).catch(() => {});
              }
            }
          }
          return Array.from(existing.values());
        });
      }

      if (data.projects && userRef.current) {
        for (const p of data.projects) {
          const project: Project = {
            id: p.id || crypto.randomUUID(),
            userId: userRef.current.uid,
            name: p.name,
            description: p.description,
            status: 'active',
            platforms: p.platforms || [],
            createdAt: p.startedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          createProject(project).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('demo') === '1') {
      // Demo mode: load fake data + AI detect
      setIsDemo(true);
      const dLogs = generateDemoLogs();
      setLogs(dLogs);
      setLoading(false);
      fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: dLogs, action: 'detect_projects' }),
      })
        .then((r) => r.json())
        .then((data) => { if (data.projects) setDemoProjects(data.projects); })
        .catch(() => {});
      return;
    }

    // Live mode: read from /api/logs (synced by extension)
    // Try auth for user info + Firestore persistence
    if (auth) {
      auth.onAuthStateChanged(async (u) => {
        if (u) {
          userRef.current = u;
          setUser(u);
          // Load persisted data from Firestore
          try {
            let [firestoreLogs, firestoreProjects] = await Promise.all([
              getLogsByUser(u.uid),
              getProjectsByUser(u.uid),
            ]);
            // Fallback: if no user-specific data, load all (hackathon single-user mode)
            if (firestoreLogs.length === 0) {
              firestoreLogs = await getAllLogs();
            }
            if (firestoreProjects.length === 0) {
              firestoreProjects = await getAllProjects();
            }
            if (firestoreLogs.length > 0) setLogs(firestoreLogs);
            if (firestoreProjects.length > 0) setProjects(firestoreProjects);
          } catch (err) {
            console.error('Failed to load Firestore data:', err);
          }
        }
      });
    }

    // Initial fetch
    fetchLiveLogs().then(() => setLoading(false));

    // Poll every 3 seconds for new logs
    const interval = setInterval(fetchLiveLogs, 3000);
    return () => clearInterval(interval);
  }, [router]);

  const activeProjects = useMemo(() => {
    if (isDemo) return demoProjects;
    // Merge Firestore projects with auto-detected projects, deduplicate by name
    const all: DemoProject[] = [...projects.map((p) => ({
      name: p.name,
      description: p.description || '',
      logIds: [],
      platforms: p.platforms || [],
      startedAt: p.createdAt,
    }))];
    for (const dp of demoProjects) {
      if (!all.find((a) => a.name === dp.name)) {
        all.push(dp);
      }
    }
    return all;
  }, [isDemo, projects, demoProjects]);

  const { logColorMap, projectColors } = useMemo(() => {
    const map: Record<string, typeof PROJECT_PALETTE[0]> = {};
    const pColors: { project: any; color: typeof PROJECT_PALETTE[0] }[] = [];
    activeProjects.forEach((p, i) => {
      const color = PROJECT_PALETTE[i % PROJECT_PALETTE.length];
      pColors.push({ project: p, color });
      ((p as any).logIds || []).forEach((id: string) => { map[id] = color; });
    });
    return { logColorMap: map, projectColors: pColors };
  }, [activeProjects]);

  const sortedLogs = useMemo(() =>
    [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
  [logs]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: '-apple-system, sans-serif', color: '#9ca3af' }}>Loading...</div>;

  const stats = {
    total: logs.length,
    prompts: logs.filter(l => l.type === 'prompt').length,
    projects: activeProjects.length,
    platforms: [...new Set(logs.map(l => l.platform))].length,
  };

  const selColor = selectedLog ? (logColorMap[selectedLog.id] || GRAY) : null;

  // Grid config - fill more space
  const COLS = 16;
  const DOT = 18;
  const GAP = 5;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: selectedLog ? '1fr 400px' : '1fr',
      height: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
      background: '#ffffff', color: '#1a1a1a',
      transition: 'grid-template-columns 0.2s',
    }}>
      {/* ── Left ──────────────────────────────────────────────── */}
      <div style={{ overflow: 'auto', padding: '24px 32px' }}>
        {/* Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>HumanProof</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isDemo && <span style={{ fontSize: 12, color: '#9ca3af' }}>{user?.email}</span>}
            <button onClick={() => router.push(isDemo ? '/dashboard/flow?demo=1' : '/dashboard/flow')}
              style={{ padding: '7px 16px', fontSize: 12, background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              Creative Flow ⎇
            </button>
            {!isDemo && (
              <button onClick={() => auth && signOut(auth)}
                style={{ padding: '7px 16px', fontSize: 12, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                Sign Out
              </button>
            )}
          </div>
        </header>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 32, marginBottom: 24 }}>
          {[
            { n: stats.total, l: 'interactions' },
            { n: stats.projects, l: 'projects' },
            { n: stats.platforms, l: 'platforms' },
            { n: stats.prompts, l: 'prompts' },
          ].map((s, i) => (
            <div key={i}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#1a1a1a' }}>{s.n}</span>
              <span style={{ fontSize: 13, color: '#9ca3af', marginLeft: 6 }}>{s.l}</span>
            </div>
          ))}
        </div>

        {/* Project legend */}
        {projectColors.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {projectColors.slice(0, 7).map(({ project, color }, i) => (
              <div key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 20,
                background: color.bg, fontSize: 12, fontWeight: 600, color: color.text,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color.dot }}></span>
                {project.name}
              </div>
            ))}
            {projectColors.length > 7 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 20,
                background: '#f3f4f6', fontSize: 12, color: '#6b7280',
              }}>
                +{projectColors.length - 7} more
              </div>
            )}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 14px', borderRadius: 20,
              background: '#f9fafb', fontSize: 12, color: '#9ca3af',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d1d5db' }}></span>
              Unassigned
            </div>
          </div>
        )}

        {/* ── Dot Grid ─────────────────────────────────────────── */}
        {sortedLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#9ca3af' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>◉</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>No interactions yet</h3>
            <p style={{ fontSize: 13 }}>Each dot = one AI interaction. Colored by project.</p>
            <a href="/dashboard?demo=1" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none', marginTop: 12, display: 'inline-block' }}>Try demo mode →</a>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${COLS}, ${DOT}px)`,
            gap: GAP,
            padding: 20,
            background: '#fafafa',
            borderRadius: 16,
            border: '1px solid #f0f0f0',
            justifyContent: 'center',
          }}>
            {sortedLogs.map((log) => {
              const color = logColorMap[log.id] || GRAY;
              const isSel = selectedLog?.id === log.id;
              const isHov = hoveredLog === log.id;
              const isPrompt = log.type === 'prompt';
              const hasImg = !!(log as any).screenshotUrl || !!(log as any).hasScreenshot;

              return (
                <div
                  key={log.id}
                  onClick={() => setSelectedLog(isSel ? null : log)}
                  onMouseEnter={() => setHoveredLog(log.id)}
                  onMouseLeave={() => setHoveredLog(null)}
                  style={{
                    width: DOT,
                    height: DOT,
                    borderRadius: isPrompt ? '50%' : 4,
                    background: color.dot,
                    opacity: isSel ? 1 : isHov ? 0.95 : (logColorMap[log.id] ? 0.7 : 0.25),
                    cursor: 'pointer',
                    transition: 'all 0.12s ease',
                    transform: isSel ? 'scale(1.5)' : isHov ? 'scale(1.25)' : 'scale(1)',
                    boxShadow: isSel ? `0 0 0 3px ${color.dot}40, 0 2px 8px ${color.dot}30` : 'none',
                    position: 'relative',
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Legend */}
        {sortedLogs.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: '#b0b0b0' }}>
            <span>● prompt</span>
            <span>■ response</span>
            <span style={{ marginLeft: 'auto' }}>colored = project · gray = unassigned</span>
          </div>
        )}

        {/* Timeline */}
        {sortedLogs.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 12 }}>Recent Activity</h3>
            {[...sortedLogs].reverse().slice(0, 10).map((log) => {
              const color = logColorMap[log.id] || GRAY;
              const isSel = selectedLog?.id === log.id;
              return (
                <div
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', marginBottom: 2, borderRadius: 8,
                    cursor: 'pointer', background: isSel ? color.bg : 'transparent',
                    borderLeft: `3px solid ${color.dot}`,
                    transition: 'background 0.1s',
                  }}
                >
                  <span style={{ fontSize: 10, color: color.text || color.dot, fontWeight: 700, textTransform: 'uppercase', minWidth: 56 }}>
                    {log.platform}
                  </span>
                  <span style={{ fontSize: 10, color: '#c0c0c0', minWidth: 48 }}>{log.type}</span>
                  <span style={{ fontSize: 12, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(log.content || '').substring(0, 80)}
                  </span>
                  <span style={{ fontSize: 10, color: '#d1d5db' }}>
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Right: Detail Panel ────────────────────────────────── */}
      {selectedLog && selColor && (
        <div style={{ borderLeft: '1px solid #e5e7eb', overflowY: 'auto', background: '#fafafa' }}>
          {/* Header image/screenshot area */}
          <div style={{
            height: 200, background: `linear-gradient(135deg, ${selColor.dot}15, ${selColor.dot}05)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative', overflow: 'hidden',
          }}>
            {(selectedLog as any).screenshotUrl ? (
              <img src={(selectedLog as any).screenshotUrl} alt="Screenshot"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: selectedLog.type === 'prompt' ? '50%' : 8,
                  background: selColor.dot, margin: '0 auto 8px', opacity: 0.3,
                }}></div>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>No screenshot</span>
              </div>
            )}
            {/* Close button */}
            <button onClick={() => setSelectedLog(null)} style={{
              position: 'absolute', top: 12, right: 12,
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(255,255,255,0.9)', border: 'none',
              fontSize: 14, cursor: 'pointer', color: '#6b7280',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>

          <div style={{ padding: '20px 24px' }}>
            {/* Platform + project badges */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: selColor.bg, color: selColor.text, textTransform: 'uppercase',
              }}>
                {selectedLog.platform}
              </span>
              <span style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: selectedLog.type === 'prompt' ? '#dbeafe' : '#dcfce7',
                color: selectedLog.type === 'prompt' ? '#1e40af' : '#166534',
              }}>
                {selectedLog.type}
              </span>
              {selectedLog.model && (
                <span style={{
                  padding: '3px 10px', borderRadius: 6, fontSize: 11,
                  background: '#f3f4f6', color: '#6b7280',
                }}>
                  {selectedLog.model}
                </span>
              )}
            </div>

            {/* Project name */}
            {logColorMap[selectedLog.id] && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 3, fontWeight: 600, letterSpacing: '0.05em' }}>Project</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {activeProjects.find(p => ((p as any).logIds || []).includes(selectedLog.id))?.name || '—'}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  {(activeProjects.find(p => ((p as any).logIds || []).includes(selectedLog.id)) as any)?.description || ''}
                </div>
              </div>
            )}

            {/* Timestamp */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 3, fontWeight: 600, letterSpacing: '0.05em' }}>Timestamp</div>
              <div style={{ fontSize: 13 }}>{new Date(selectedLog.timestamp).toLocaleString()}</div>
            </div>

            {/* Content */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 3, fontWeight: 600, letterSpacing: '0.05em' }}>Content</div>
              <div style={{
                fontSize: 13, lineHeight: 1.7, padding: 14,
                background: '#ffffff', borderRadius: 10, border: '1px solid #e5e7eb',
                maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap',
              }}>
                {selectedLog.content}
              </div>
            </div>

            {/* Metadata */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px',
              padding: 14, background: '#ffffff', borderRadius: 10, border: '1px solid #e5e7eb',
              fontSize: 12,
            }}>
              <div><span style={{ color: '#9ca3af' }}>Platform</span></div>
              <div style={{ textAlign: 'right', fontWeight: 600 }}>{selectedLog.platform}</div>
              <div><span style={{ color: '#9ca3af' }}>Type</span></div>
              <div style={{ textAlign: 'right', fontWeight: 600 }}>{selectedLog.type}</div>
              {selectedLog.model && (<>
                <div><span style={{ color: '#9ca3af' }}>Model</span></div>
                <div style={{ textAlign: 'right', fontWeight: 600 }}>{selectedLog.model}</div>
              </>)}
              <div><span style={{ color: '#9ca3af' }}>Log ID</span></div>
              <div style={{ textAlign: 'right', fontWeight: 500, fontSize: 10, color: '#9ca3af' }}>{selectedLog.id}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Demo data (dense — 60+ logs for visual impact) ──────────────

function generateDemoLogs(): CaptureLog[] {
  const base = new Date('2026-04-12T09:00:00').getTime();
  const m = (mins: number) => new Date(base + mins * 60000).toISOString();
  const L = (id: string, plat: string, model: string, type: string, content: string, mins: number) =>
    ({ id, userId: 'demo', platform: plat, model, type, content, timestamp: m(mins) } as any);

  return [
    // ── Project 1: Lawgic Brand Identity (12 logs) ──
    L('b1', 'chatgpt', 'GPT-4o', 'prompt', 'I need a minimalist logo for a legal tech startup called "Lawgic". Geometric, modern, trustworthy.', 0),
    L('b2', 'chatgpt', 'GPT-4o', 'response', 'Here are 5 logo concepts: 1) Hexagon with scales of justice... 2) Abstract L with gradient...', 2),
    L('b3', 'chatgpt', 'GPT-4o', 'prompt', 'I like concept 3 but make it more angular. Navy blue and gold palette.', 5),
    L('b4', 'chatgpt', 'GPT-4o', 'response', 'Updated angular L-pillar in navy (#1e3a5f) and gold (#c9a84c)...', 7),
    L('b5', 'claude', 'Claude Sonnet', 'prompt', 'Write a tagline for Lawgic. Tone: professional but approachable.', 10),
    L('b6', 'claude', 'Claude Sonnet', 'response', '"Where legal meets logical." / "Law, simplified." / "Smart law for modern teams."', 11),
    L('b7', 'claude', 'Claude Sonnet', 'prompt', 'I love "Where legal meets logical." Give me 3 variations that play on logic.', 14),
    L('b8', 'claude', 'Claude Sonnet', 'response', '1. "Legal logic, beautifully applied." 2. "The logical side of law." 3. "Logic-powered legal."', 15),
    L('b9', 'midjourney', 'Midjourney v6', 'prompt', '/imagine minimalist legal tech logo, angular L shape, navy blue and gold --ar 1:1', 18),
    L('b10', 'midjourney', 'Midjourney v6', 'response', '[4 image variations generated] Angular L-pillar designs with navy and gold', 20),
    L('b11', 'chatgpt', 'GPT-4o', 'prompt', 'Combine the L-pillar from Midjourney with "The logical side of law" from Claude. SVG mockup on business card.', 28),
    L('b12', 'chatgpt', 'GPT-4o', 'response', 'Complete brand mockup with angular L-pillar, tagline, and business card layout...', 31),

    // ── Gray: random / non-project ──
    L('g1', 'chatgpt', 'GPT-4o', 'prompt', 'What is the capital of France?', 35),
    L('g2', 'chatgpt', 'GPT-4o', 'response', 'The capital of France is Paris.', 36),
    L('g3', 'claude', 'Claude Haiku', 'prompt', 'Translate "hello world" to Japanese', 38),
    L('g4', 'claude', 'Claude Haiku', 'response', 'こんにちは世界 (Konnichiwa sekai)', 39),

    // ── Project 2: SaaS Legal Documentation (14 logs) ──
    L('c1', 'claude', 'Claude Sonnet', 'prompt', 'Draft a SaaS subscription agreement for B2B legal tech. Include data processing sections.', 45),
    L('c2', 'claude', 'Claude Sonnet', 'response', 'SAAS SUBSCRIPTION AGREEMENT\nSection 1. Definitions... Section 2. Services...', 47),
    L('c3', 'claude', 'Claude Sonnet', 'prompt', 'Add LFPDPPP compliance clause and ICC Mexico arbitration section.', 50),
    L('c4', 'claude', 'Claude Sonnet', 'response', 'Updated with Mexican data protection (LFPDPPP) and ICC arbitration...', 52),
    L('c5', 'chatgpt', 'GPT-4o', 'prompt', 'Review this SaaS agreement for risks from a startup founder perspective.', 55),
    L('c6', 'chatgpt', 'GPT-4o', 'response', 'Key risks: 1) Broad indemnification... 2) Auto-renewal 60-day notice... 3) IP assignment...', 57),
    L('c7', 'claude', 'Claude Sonnet', 'prompt', 'Fix indemnification — limit to direct damages. Cap liability at 12 months of fees.', 60),
    L('c8', 'claude', 'Claude Sonnet', 'response', 'Updated indemnification limited to direct damages with 12-month cap...', 62),
    L('c9', 'chatgpt', 'GPT-4o', 'prompt', 'Now draft a DPA (Data Processing Addendum) that complements this SaaS agreement.', 65),
    L('c10', 'chatgpt', 'GPT-4o', 'response', 'DATA PROCESSING ADDENDUM\n1. Definitions... 2. Processing instructions... 3. Sub-processors...', 67),
    L('c11', 'claude', 'Claude Sonnet', 'prompt', 'Add GDPR Article 28 requirements and standard contractual clauses reference.', 70),
    L('c12', 'claude', 'Claude Sonnet', 'response', 'Updated DPA with full GDPR Art. 28 compliance and SCC references...', 72),
    L('c13', 'claude', 'Claude Sonnet', 'prompt', 'Perfect, this looks good. Approved for legal review.', 74),
    L('c14', 'claude', 'Claude Sonnet', 'response', 'Great! The SaaS Agreement and DPA are ready for counsel review...', 75),

    // ── Gray noise ──
    L('g5', 'chatgpt', 'GPT-4o', 'prompt', 'How do I make pasta carbonara?', 78),
    L('g6', 'chatgpt', 'GPT-4o', 'response', 'Classic carbonara: guanciale, eggs, pecorino, pepper, spaghetti...', 79),
    L('g7', 'claude', 'Claude Haiku', 'prompt', 'What time is it in Tokyo right now?', 81),
    L('g8', 'claude', 'Claude Haiku', 'response', 'It would be approximately 1:00 AM the next day in Tokyo (JST is UTC+9).', 82),

    // ── Project 3: Series A Pitch Deck (12 logs) ──
    L('p1', 'claude', 'Claude Sonnet', 'prompt', 'Write slide copy for a Series A pitch deck for Lawgic. 10 slides. Market size and traction.', 85),
    L('p2', 'claude', 'Claude Sonnet', 'response', 'Slide 1: Lawgic — The OS for Modern Legal Teams\nSlide 2: Problem — $300B market...', 88),
    L('p3', 'claude', 'Claude Sonnet', 'prompt', 'Slide 5 needs more punch. 47 enterprise clients, 200% YoY growth.', 91),
    L('p4', 'claude', 'Claude Sonnet', 'response', 'Slide 5: "47 enterprise clients across 3 countries. 200% year-over-year growth..."', 93),
    L('p5', 'chatgpt', 'GPT-4o', 'prompt', 'Create a compelling one-liner for investor emails introducing Lawgic.', 96),
    L('p6', 'chatgpt', 'GPT-4o', 'response', '"Lawgic is the Figma for legal workflows — 47 clients, 200% growth, raising Series A."', 98),
    L('p7', 'chatgpt', 'GPT-4o', 'prompt', 'Make it shorter and more punchy. Remove the comparison.', 100),
    L('p8', 'chatgpt', 'GPT-4o', 'response', '"47 enterprise clients. 200% growth. Legal workflows, reimagined. We\'re raising Series A."', 101),
    L('p9', 'claude', 'Claude Sonnet', 'prompt', 'Draft the financial slide: $2.1M ARR, 85% gross margin, 18-month runway at current burn.', 104),
    L('p10', 'claude', 'Claude Sonnet', 'response', 'Slide 8 — Financials: $2.1M ARR with 85% gross margin. 18-month runway...', 106),
    L('p11', 'midjourney', 'Midjourney v6', 'prompt', '/imagine professional slide background, dark gradient, subtle geometric legal pattern', 109),
    L('p12', 'midjourney', 'Midjourney v6', 'response', '[4 background variations] Dark gradient with geometric legal patterns', 111),

    // ── More gray ──
    L('g9', 'chatgpt', 'GPT-4o', 'prompt', 'Recommend a good book about startups', 115),
    L('g10', 'chatgpt', 'GPT-4o', 'response', 'I recommend "The Hard Thing About Hard Things" by Ben Horowitz...', 116),
    L('g11', 'claude', 'Claude Haiku', 'prompt', 'What is 2^32?', 118),
    L('g12', 'claude', 'Claude Haiku', 'response', '2^32 = 4,294,967,296', 119),

    // ── Project 4: Product Landing Page (8 logs) ──
    L('l1', 'claude', 'Claude Sonnet', 'prompt', 'Write hero copy for Lawgic landing page. Above the fold. CTA: "Start Free Trial"', 125),
    L('l2', 'claude', 'Claude Sonnet', 'response', 'Hero: "Legal workflows that actually work."\nSub: "From contract drafting to compliance..."', 127),
    L('l3', 'chatgpt', 'GPT-4o', 'prompt', 'Write 3 feature sections: AI Contract Review, Compliance Dashboard, Team Collaboration', 130),
    L('l4', 'chatgpt', 'GPT-4o', 'response', 'Feature 1: AI Contract Review — Review contracts 10x faster with AI-powered clause analysis...', 132),
    L('l5', 'claude', 'Claude Sonnet', 'prompt', 'Write testimonial-style social proof. 3 fake but realistic quotes from GC personas.', 135),
    L('l6', 'claude', 'Claude Sonnet', 'response', '"Lawgic cut our contract review time by 70%" — Sarah Chen, GC at TechCorp...', 137),
    L('l7', 'chatgpt', 'GPT-4o', 'prompt', 'Write the pricing section: Starter $49/mo, Pro $149/mo, Enterprise custom.', 140),
    L('l8', 'chatgpt', 'GPT-4o', 'response', 'Starter — $49/mo: 100 contracts, 1 user, basic AI review...', 142),
  ];
}
