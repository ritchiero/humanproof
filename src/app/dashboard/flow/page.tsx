'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { getLogsByUser, getProjectsByUser } from '@/lib/firestore';
import type { CaptureLog, Project } from '@/types';

// ── Types ────────────────────────────────────────────────────────

interface FlowNode {
  id: string;
  log: CaptureLog;
  x: number;
  y: number;
  track: number; // horizontal track (0 = trunk, ±1, ±2 = branches)
  conversationUrl?: string;
  stage: CreativeStage;
}

interface FlowEdge {
  from: string;
  to: string;
  type: 'sequential' | 'branch' | 'merge' | 'cross-platform';
}

// ── Constants ────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, { bg: string; border: string; text: string; line: string }> = {
  chatgpt: { bg: '#dcfce7', border: '#16a34a', text: '#166534', line: '#22c55e' },
  claude: { bg: '#fff7ed', border: '#ea580c', text: '#9a3412', line: '#f97316' },
  midjourney: { bg: '#dbeafe', border: '#2563eb', text: '#1e40af', line: '#3b82f6' },
  figma: { bg: '#f3e8ff', border: '#9333ea', text: '#6b21a8', line: '#a855f7' },
  manual: { bg: '#f1f5f9', border: '#64748b', text: '#334155', line: '#94a3b8' },
};

const NODE_W = 280;
const NODE_H = 72;
const ROW_H = 100; // vertical spacing between rows
const TRACK_W = 160; // horizontal spacing between tracks
const CENTER_X = 500; // center of the trunk
const PADDING_TOP = 60;

// ── Creative Stages ──────────────────────────────────────────────

type CreativeStage =
  | 'ideación' | 'dirección' | 'exploración' | 'selección'
  | 'edición' | 'corrección' | 'combinación' | 'refinamiento'
  | 'validación' | 'respuesta';

const STAGE_CONFIG: Record<CreativeStage, { emoji: string; color: string; bg: string; usco: string }> = {
  'ideación':     { emoji: '💡', color: '#7c3aed', bg: '#f5f3ff', usco: 'EXPRESSIVE_INPUT' },
  'dirección':    { emoji: '🎯', color: '#2563eb', bg: '#eff6ff', usco: 'EXPRESSIVE_INPUT' },
  'exploración':  { emoji: '🔍', color: '#0891b2', bg: '#ecfeff', usco: 'COORDINATION' },
  'selección':    { emoji: '✓',  color: '#16a34a', bg: '#f0fdf4', usco: 'SELECTION' },
  'edición':      { emoji: '✏️', color: '#ca8a04', bg: '#fefce8', usco: 'MODIFICATION' },
  'corrección':   { emoji: '🔧', color: '#dc2626', bg: '#fef2f2', usco: 'MODIFICATION' },
  'combinación':  { emoji: '🧩', color: '#9333ea', bg: '#faf5ff', usco: 'COORDINATION' },
  'refinamiento': { emoji: '✨', color: '#ea580c', bg: '#fff7ed', usco: 'ARRANGEMENT' },
  'validación':   { emoji: '✅', color: '#059669', bg: '#ecfdf5', usco: 'SELECTION' },
  'respuesta':    { emoji: '🤖', color: '#6b7280', bg: '#f9fafb', usco: '' },
};

function detectStage(log: CaptureLog, index: number, allLogs: CaptureLog[]): CreativeStage {
  if (log.type === 'response') return 'respuesta';
  const text = (log.content || '').toLowerCase();
  if (text.match(/combin|junt|merg|integr|une|mezcl|from.*and|junto con|final version|versión final/)) return 'combinación';
  if (text.match(/me gusta|i like|prefiero|prefer|elijo|choose|el \d|option \d|concepto \d|let'?s go with/)) return 'selección';
  if (text.match(/error|bug|fix|arregl|correg|wrong|mal|equivoc|no funciona/)) return 'corrección';
  if (text.match(/perfect|listo|aprobad|approved|looks good|está bien|go ahead|ship it|así está bien|confirmo/)) return 'validación';
  if (text.match(/cambia|change|modific|edit|replac|reemplaz|swap|quita|remove|agrega|add|pon|put/)) return 'edición';
  if (text.match(/más|more|menos|less|mejor|better|pero |hazlo|make it|adjust|tweak|sutil|slight|un poco/)) return 'refinamiento';
  if (text.match(/estilo|style|tono|tone|color|palette|font|tipograf|layout|diseño|format|estructura/)) return 'dirección';
  if (text.match(/variac|variation|altern|option|opcion|dame \d|give me \d|explor|qué tal si|what if|prueba|try|imagina|otra/)) return 'exploración';
  const sameConv = allLogs.filter((l) => (l as any).conversationUrl === (log as any).conversationUrl && l.type === 'prompt');
  const isFirst = sameConv.length === 0 || sameConv[0]?.id === log.id;
  if (isFirst) return 'ideación';
  return 'dirección';
}

// ── Component ────────────────────────────────────────────────────

export default function FlowPage() {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [logs, setLogs] = useState<CaptureLog[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  const [aiStages, setAiStages] = useState<Record<string, CreativeStage>>({});
  const [classifying, setClassifying] = useState(false);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // ── Data loading ───────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      const demoLogs = generateDemoLogs();
      setLogs(demoLogs);
      setLoading(false);
      fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: demoLogs, action: 'classify_stages' }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.stages) {
            const map: Record<string, CreativeStage> = {};
            for (const s of data.stages) {
              if (STAGE_CONFIG[s.stage as CreativeStage]) map[s.id] = s.stage as CreativeStage;
            }
            setAiStages(map);
          }
        })
        .catch(() => {});
      return;
    }

    // Try live API first, then Firestore
    fetch('/api/logs')
      .then((r) => r.json())
      .then((data) => {
        if (data.logs && data.logs.length > 0) {
          setLogs(data.logs);
          if (data.stages) setAiStages(data.stages);
          setLoading(false);
        } else {
          throw new Error('no live logs');
        }
      })
      .catch(() => {
        const unsub = auth.onAuthStateChanged(async (u) => {
          if (!u) { router.push('/'); return; }
          try {
            const [l, p] = await Promise.all([getLogsByUser(u.uid), getProjectsByUser(u.uid)]);
            setLogs(l);
            setProjects(p);
          } catch (err) { console.error(err); }
          setLoading(false);
        });
        return unsub;
      });
  }, [router]);

  // ── Build tree graph ──────────────────────────────────────────

  const buildGraph = useCallback((): { nodes: FlowNode[]; edges: FlowEdge[] } => {
    if (logs.length === 0) return { nodes: [], edges: [] };

    const sorted = [...logs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Assign tracks: first conversation = trunk (0), others branch off alternating ±1, ±2...
    const convToTrack = new Map<string, number>();
    let nextTrackSide = 1; // alternates: 1, -1, 2, -2...
    const trackSigns = [1, -1]; // alternate sides
    let trackIdx = 0;

    // Find conversation order (by first appearance)
    for (const log of sorted) {
      const convKey = (log as any).conversationUrl || `${log.platform}_default`;
      if (!convToTrack.has(convKey)) {
        if (convToTrack.size === 0) {
          convToTrack.set(convKey, 0); // trunk
        } else {
          const track = Math.ceil((trackIdx + 1) / 2) * trackSigns[trackIdx % 2];
          convToTrack.set(convKey, track);
          trackIdx++;
        }
      }
    }

    // Place nodes chronologically — each row is one step in time
    const nodes: FlowNode[] = [];
    const convNodeCount = new Map<string, number>();

    for (let i = 0; i < sorted.length; i++) {
      const log = sorted[i];
      const convKey = (log as any).conversationUrl || `${log.platform}_default`;
      const track = convToTrack.get(convKey) || 0;
      const count = convNodeCount.get(convKey) || 0;
      convNodeCount.set(convKey, count + 1);

      const stage = aiStages[log.id] || detectStage(log, count, sorted);

      nodes.push({
        id: log.id,
        log,
        x: CENTER_X + track * TRACK_W - NODE_W / 2,
        y: PADDING_TOP + i * ROW_H,
        track,
        conversationUrl: (log as any).conversationUrl,
        stage,
      });
    }

    // Build edges
    const edges: FlowEdge[] = [];
    const lastNodeByConv = new Map<string, FlowNode>();
    const allConvFirstNode = new Map<string, FlowNode>();

    for (const node of nodes) {
      const convKey = node.conversationUrl || `${node.log.platform}_default`;
      const prev = lastNodeByConv.get(convKey);

      if (prev) {
        // Sequential within same conversation
        edges.push({ from: prev.id, to: node.id, type: 'sequential' });
      } else {
        // First node of this conversation — find branch origin
        allConvFirstNode.set(convKey, node);
        if (node.track !== 0) {
          // Find the closest previous node in any other conversation
          const nodeTime = new Date(node.log.timestamp).getTime();
          let bestMatch: FlowNode | null = null;
          let bestDiff = Infinity;
          for (const other of nodes) {
            if (other.id === node.id) break; // only look at earlier nodes
            const diff = nodeTime - new Date(other.log.timestamp).getTime();
            if (diff >= 0 && diff < bestDiff) {
              bestDiff = diff;
              bestMatch = other;
            }
          }
          if (bestMatch) {
            edges.push({
              from: bestMatch.id,
              to: node.id,
              type: bestMatch.log.platform !== node.log.platform ? 'cross-platform' : 'branch',
            });
          }
        }
      }
      lastNodeByConv.set(convKey, node);
    }

    // Detect merge edges: when content references combining from multiple sources
    for (const node of nodes) {
      if (node.stage === 'combinación') {
        // Find the last node from each other active conversation
        for (const [convKey, lastNode] of lastNodeByConv) {
          const thisConvKey = node.conversationUrl || `${node.log.platform}_default`;
          if (convKey !== thisConvKey && lastNode.track !== node.track) {
            const timeDiff = new Date(node.log.timestamp).getTime() - new Date(lastNode.log.timestamp).getTime();
            if (timeDiff > 0 && timeDiff < 1000 * 60 * 60) { // within 1 hour
              const alreadyHasEdge = edges.some(e => e.from === lastNode.id && e.to === node.id);
              if (!alreadyHasEdge) {
                edges.push({ from: lastNode.id, to: node.id, type: 'merge' });
              }
            }
          }
        }
      }
    }

    return { nodes, edges };
  }, [logs, aiStages]);

  const { nodes, edges } = buildGraph();

  // ── SVG dimensions ─────────────────────────────────────────────

  const maxX = Math.max(1200, ...nodes.map(n => n.x + NODE_W + 80));
  const maxY = Math.max(600, ...nodes.map(n => n.y + NODE_H + 80));

  // ── Pan/zoom ──────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.flow-node')) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handleMouseUp = () => setDragging(false);
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(2, Math.max(0.2, z + (e.deltaY > 0 ? -0.08 : 0.08))));
  };

  // ── Render helpers ─────────────────────────────────────────────

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Track lines — vertical lines for each conversation track
  function renderTrackLines() {
    const trackNodes = new Map<number, FlowNode[]>();
    for (const n of nodes) {
      const arr = trackNodes.get(n.track) || [];
      arr.push(n);
      trackNodes.set(n.track, arr);
    }

    return Array.from(trackNodes.entries()).map(([track, tNodes]) => {
      if (tNodes.length < 2) return null;
      const platform = tNodes[0].log.platform;
      const colors = PLATFORM_COLORS[platform] || PLATFORM_COLORS.manual;
      const points = tNodes.map(n => ({
        x: n.x + NODE_W / 2,
        y1: n.y,
        y2: n.y + NODE_H,
      }));

      const segments = [];
      for (let i = 0; i < points.length - 1; i++) {
        segments.push(
          <line
            key={`track-${track}-${i}`}
            x1={points[i].x} y1={points[i].y2}
            x2={points[i + 1].x} y2={points[i + 1].y1}
            stroke={colors.line} strokeWidth={3} opacity={0.25}
          />
        );
      }
      return <g key={`track-${track}`}>{segments}</g>;
    });
  }

  function renderEdge(edge: FlowEdge, i: number) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) return null;

    const x1 = from.x + NODE_W / 2;
    const y1 = from.y + NODE_H;
    const x2 = to.x + NODE_W / 2;
    const y2 = to.y;

    const isBranch = edge.type === 'branch' || edge.type === 'cross-platform';
    const isMerge = edge.type === 'merge';

    const color = isMerge ? '#9333ea' :
      edge.type === 'cross-platform' ? '#ea580c' :
      edge.type === 'branch' ? '#3b82f6' :
      '#d1d5db';

    const opacity = isMerge ? 0.5 : isBranch ? 0.7 : 0.4;
    const strokeWidth = isMerge ? 2.5 : isBranch ? 2 : 2;
    const dashArray = (isBranch || isMerge) ? '8,5' : 'none';

    if (from.track !== to.track) {
      // Curved connection between tracks
      const midY = (y1 + y2) / 2;
      const cp1x = x1;
      const cp1y = y1 + (midY - y1) * 0.7;
      const cp2x = x2;
      const cp2y = y2 - (y2 - midY) * 0.7;
      const path = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
      return (
        <g key={`edge-${i}`}>
          <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeDasharray={dashArray} opacity={opacity} />
          <circle cx={x2} cy={y2} r={4} fill={color} opacity={opacity} />
        </g>
      );
    }

    // Straight connection within same track
    return (
      <g key={`edge-${i}`}>
        <line x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color} strokeWidth={strokeWidth} opacity={opacity}
          strokeDasharray={dashArray} />
      </g>
    );
  }

  function renderNode(node: FlowNode) {
    const colors = PLATFORM_COLORS[node.log.platform] || PLATFORM_COLORS.manual;
    const stageConf = STAGE_CONFIG[node.stage];
    const isSelected = selectedNode?.id === node.id;
    const truncated = (node.log.content || '').substring(0, 70) + ((node.log.content?.length || 0) > 70 ? '...' : '');
    const time = new Date(node.log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const stageLabel = node.stage.charAt(0).toUpperCase() + node.stage.slice(1);

    // Node dot on the track line
    const dotX = node.x + NODE_W / 2;
    const dotY = node.y + NODE_H / 2;

    return (
      <g
        key={node.id}
        className="flow-node"
        style={{ cursor: 'pointer' }}
        onClick={() => setSelectedNode(isSelected ? null : node)}
      >
        {/* Track dot — the "node" on the branch line */}
        <circle cx={node.x + (node.track >= 0 ? 0 : NODE_W)} cy={node.y + NODE_H / 2}
          r={6} fill={colors.line} stroke="#fff" strokeWidth={2} />

        {/* Card shadow */}
        <rect x={node.x + 1} y={node.y + 1} width={NODE_W} height={NODE_H}
          rx={12} fill="rgba(0,0,0,0.04)" />
        {/* Card body */}
        <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H}
          rx={12}
          fill={isSelected ? stageConf.bg : '#ffffff'}
          stroke={isSelected ? stageConf.color : '#e2e8f0'}
          strokeWidth={isSelected ? 2.5 : 1}
        />

        {/* Left accent */}
        <rect x={node.x} y={node.y + 8} width={3} height={NODE_H - 16}
          rx={2} fill={stageConf.color} />

        {/* Row 1: Platform + Stage + Time */}
        <rect x={node.x + 12} y={node.y + 8} width={node.log.platform.length * 6.2 + 12} height={14}
          rx={3} fill={colors.bg} />
        <text x={node.x + 18} y={node.y + 18} fontSize={8} fontWeight={700} fill={colors.text}
          fontFamily="Inter, -apple-system, sans-serif" style={{ textTransform: 'uppercase' } as any}>
          {node.log.platform}
        </text>

        <rect x={node.x + 12 + node.log.platform.length * 6.2 + 16} y={node.y + 8}
          width={stageLabel.length * 5.5 + 22} height={14} rx={3} fill={stageConf.bg} />
        <text x={node.x + 12 + node.log.platform.length * 6.2 + 22} y={node.y + 18}
          fontSize={8} fontWeight={700} fill={stageConf.color}
          fontFamily="Inter, -apple-system, sans-serif">
          {stageConf.emoji} {stageLabel}
        </text>

        <text x={node.x + NODE_W - 10} y={node.y + 18} fontSize={8} fill="#94a3b8" textAnchor="end"
          fontFamily="Inter, -apple-system, sans-serif">{time}</text>

        {/* Row 2: Content */}
        <text x={node.x + 12} y={node.y + 38} fontSize={11} fill="#334155"
          fontFamily="Inter, -apple-system, sans-serif">
          {truncated.substring(0, 42)}
        </text>
        {truncated.length > 42 && (
          <text x={node.x + 12} y={node.y + 52} fontSize={10} fill="#94a3b8"
            fontFamily="Inter, -apple-system, sans-serif">
            {truncated.substring(42, 78)}
          </text>
        )}

        {/* Row 3: Model + USCO */}
        {node.log.model && (
          <text x={node.x + 12} y={node.y + NODE_H - 6} fontSize={8} fill="#cbd5e1"
            fontFamily="Inter, -apple-system, sans-serif">{node.log.model}</text>
        )}
        {stageConf.usco && (
          <text x={node.x + NODE_W - 10} y={node.y + NODE_H - 6} fontSize={7} fill="#e2e8f0"
            textAnchor="end" fontFamily="Inter, -apple-system, sans-serif">
            USCO: {stageConf.usco}
          </text>
        )}
      </g>
    );
  }

  // ── Detail panel ──────────────────────────────────────────────

  function renderDetailPanel() {
    if (!selectedNode) return null;
    const log = selectedNode.log;
    const colors = PLATFORM_COLORS[log.platform] || PLATFORM_COLORS.manual;
    const stageConf = STAGE_CONFIG[selectedNode.stage];
    const stageLabel = selectedNode.stage.charAt(0).toUpperCase() + selectedNode.stage.slice(1);

    return (
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 380,
        background: '#ffffff', borderLeft: '1px solid #e2e8f0',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.06)',
        zIndex: 100, overflowY: 'auto', padding: 28,
        fontFamily: 'Inter, -apple-system, sans-serif',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: colors.bg, color: colors.text, textTransform: 'uppercase' }}>
              {log.platform}
            </span>
            <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: stageConf.bg, color: stageConf.color }}>
              {stageConf.emoji} {stageLabel}
            </span>
          </div>
          <button onClick={() => setSelectedNode(null)}
            style={{ background: '#f1f5f9', border: 'none', width: 28, height: 28, borderRadius: 8,
              fontSize: 14, cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ✕
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Type</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{log.type}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Time</div>
            <div style={{ fontSize: 13, color: '#334155' }}>{new Date(log.timestamp).toLocaleTimeString()}</div>
          </div>
          {log.model && (
            <div>
              <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Model</div>
              <div style={{ fontSize: 13, color: '#334155' }}>{log.model}</div>
            </div>
          )}
          {stageConf.usco && (
            <div>
              <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>USCO</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: stageConf.color }}>{stageConf.usco}</div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Content</div>
          <div style={{
            fontSize: 13, lineHeight: 1.7, padding: 14,
            background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0',
            maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap',
          }}>
            {log.content}
          </div>
        </div>

        {log.screenshotUrl && (
          <div>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Screenshot</div>
            <img src={log.screenshotUrl} alt="Screenshot" style={{
              width: '100%', borderRadius: 10, border: '1px solid #e2e8f0',
            }} />
          </div>
        )}
      </div>
    );
  }

  // ── Top bar ───────────────────────────────────────────────────

  const stageSummary = nodes.reduce((acc, n) => {
    if (n.stage !== 'respuesta') acc[n.stage] = (acc[n.stage] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // ── Main render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh',
        fontFamily: 'Inter, -apple-system, sans-serif', color: '#94a3b8' }}>
        Loading creative flow...
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', width: '100vw', overflow: 'hidden', background: '#fafbfc',
      fontFamily: 'Inter, -apple-system, sans-serif' }}>

      {/* Top bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: selectedNode ? 380 : 0, height: 52,
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', zIndex: 50,
        transition: 'right 0.2s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => router.push('/dashboard')}
            style={{ background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', color: '#6366f1', fontWeight: 600 }}>
            ← Dashboard
          </button>
          <h1 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', letterSpacing: -0.3 }}>Copyrightability Chain</h1>
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
            {nodes.length} interactions · {new Set(nodes.map(n => n.conversationUrl || n.log.platform)).size} sessions
          </span>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {Object.entries(stageSummary).map(([stage, count]) => {
              const conf = STAGE_CONFIG[stage as CreativeStage];
              return (
                <span key={stage} style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 10,
                  background: conf.bg, color: conf.color, fontWeight: 700,
                }}>
                  {conf.emoji}{count}
                </span>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 14, height: 2, background: '#d1d5db', display: 'inline-block' }} />Sequential
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 14, height: 0, borderTop: '2px dashed #3b82f6', display: 'inline-block' }} />Branch
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 14, height: 0, borderTop: '2px dashed #9333ea', display: 'inline-block' }} />Merge
            </span>
          </div>

          <button
            onClick={async () => {
              if (classifying || logs.length === 0) return;
              setClassifying(true);
              try {
                const resp = await fetch('/api/analyze', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ logs, action: 'classify_stages' }),
                });
                const data = await resp.json();
                if (data.stages) {
                  const map: Record<string, CreativeStage> = {};
                  for (const s of data.stages) {
                    if (STAGE_CONFIG[s.stage as CreativeStage]) map[s.id] = s.stage as CreativeStage;
                  }
                  setAiStages(map);
                }
              } catch (err) { console.error(err); }
              setClassifying(false);
            }}
            disabled={classifying}
            style={{
              height: 30, padding: '0 14px', fontSize: 11, fontWeight: 700,
              background: Object.keys(aiStages).length > 0
                ? 'linear-gradient(135deg, #dcfce7, #d1fae5)' : 'linear-gradient(135deg, #0f172a, #1e293b)',
              color: Object.keys(aiStages).length > 0 ? '#15803d' : '#fff',
              border: 'none', borderRadius: 8, cursor: classifying ? 'wait' : 'pointer',
              opacity: classifying ? 0.5 : 1,
            }}>
            {classifying ? 'Classifying...' : Object.keys(aiStages).length > 0 ? '✓ AI Classified' : '🤖 AI Classify'}
          </button>

          <div style={{ display: 'flex', gap: 3 }}>
            <button onClick={() => setZoom(z => Math.max(0.2, z - 0.1))}
              style={{ width: 28, height: 28, background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, color: '#64748b' }}>−</button>
            <span style={{ fontSize: 10, lineHeight: '28px', minWidth: 32, textAlign: 'center', color: '#94a3b8', fontWeight: 600 }}>
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={() => setZoom(z => Math.min(2, z + 0.1))}
              style={{ width: 28, height: 28, background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, color: '#64748b' }}>+</button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          marginTop: 52, height: 'calc(100vh - 52px)', overflow: 'hidden',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {nodes.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#94a3b8',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🌳</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>No interactions yet</h2>
            <p style={{ fontSize: 13 }}>Capture AI interactions to see your copyrightability chain grow.</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            width={maxX + 100}
            height={maxY + 100}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {/* Track backbone lines */}
            {renderTrackLines()}

            {/* Edges */}
            {edges.map((e, i) => renderEdge(e, i))}

            {/* Nodes */}
            {nodes.map(renderNode)}
          </svg>
        )}
      </div>

      {/* Detail panel */}
      {renderDetailPanel()}
    </div>
  );
}

// ── Demo data ───────────────────────────────────────────────────

function generateDemoLogs(): CaptureLog[] {
  const base = new Date('2026-04-12T09:00:00').getTime();
  const m = (mins: number) => new Date(base + mins * 60000).toISOString();

  return [
    // Conv 1: Logo design on ChatGPT (trunk)
    { id: 'd1', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'prompt', content: 'I need a minimalist logo for a legal tech startup called "Lawgic". Think geometric, modern, trustworthy.', timestamp: m(0), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,
    { id: 'd2', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'response', content: 'Here are 5 logo concepts for Lawgic: 1) A hexagon with scales of justice integrated into the geometry...', timestamp: m(2), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,
    { id: 'd3', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'prompt', content: 'I like concept 3 but make it more angular. The L should feel like a pillar of law. Use navy blue and gold palette.', timestamp: m(5), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,
    { id: 'd4', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'response', content: 'Updated concept with angular L-pillar design, navy (#1e3a5f) and gold (#c9a84c). The L doubles as a classical column...', timestamp: m(7), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,

    // Branch: Claude for copywriting
    { id: 'd5', userId: 'demo', platform: 'claude', model: 'Claude Sonnet', type: 'prompt', content: 'Write a tagline for Lawgic - a legal tech startup that uses AI to simplify legal workflows.', timestamp: m(10), conversationUrl: 'https://claude.ai/chat/tagline-conv' } as any,
    { id: 'd6', userId: 'demo', platform: 'claude', model: 'Claude Sonnet', type: 'response', content: 'Here are tagline options: "Law, simplified." / "Where legal meets logical." / "Smart law for modern teams."', timestamp: m(11), conversationUrl: 'https://claude.ai/chat/tagline-conv' } as any,
    { id: 'd7', userId: 'demo', platform: 'claude', model: 'Claude Sonnet', type: 'prompt', content: 'I love "Where legal meets logical." Now write 3 variations that play on the logic/legal intersection.', timestamp: m(14), conversationUrl: 'https://claude.ai/chat/tagline-conv' } as any,
    { id: 'd8', userId: 'demo', platform: 'claude', model: 'Claude Sonnet', type: 'response', content: '1. "Legal logic, beautifully applied." 2. "The logical side of law." 3. "Logic-powered legal."', timestamp: m(15), conversationUrl: 'https://claude.ai/chat/tagline-conv' } as any,

    // Branch: Midjourney for visual exploration
    { id: 'd9', userId: 'demo', platform: 'midjourney', model: 'Midjourney v6', type: 'prompt', content: '/imagine minimalist legal tech logo, angular L shape, pillar of law, navy blue and gold, geometric --ar 1:1', timestamp: m(18), conversationUrl: 'https://discord.com/channels/mj-server' } as any,
    { id: 'd10', userId: 'demo', platform: 'midjourney', model: 'Midjourney v6', type: 'response', content: '[4 image variations generated] Angular L-pillar designs with navy and gold geometric patterns', timestamp: m(20), conversationUrl: 'https://discord.com/channels/mj-server' } as any,
    { id: 'd11', userId: 'demo', platform: 'midjourney', model: 'Midjourney v6', type: 'prompt', content: '/imagine --v 6 variation 3 upscaled, add subtle circuit pattern in the gold, make it feel tech-forward', timestamp: m(22), conversationUrl: 'https://discord.com/channels/mj-server' } as any,

    // Back to trunk: combining everything
    { id: 'd12', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'prompt', content: 'Final version: combine the angular L-pillar from Midjourney with "The logical side of law" from Claude. Create SVG mockup.', timestamp: m(28), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,
    { id: 'd13', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'response', content: 'Here is the complete brand identity mockup with the angular L-pillar logo and tagline on a business card layout...', timestamp: m(31), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,
    { id: 'd13b', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'prompt', content: 'El gold está un poco apagado, cámbialo a un dorado más brillante tipo #D4AF37. Y el kerning necesita fix.', timestamp: m(33), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,
    { id: 'd13c', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'response', content: 'Updated: brighter gold (#D4AF37), tighter kerning between "Law" and "gic". Looks more premium now...', timestamp: m(35), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,
    { id: 'd13d', userId: 'demo', platform: 'chatgpt', model: 'GPT-4o', type: 'prompt', content: 'Perfecto, así está bien. Approved. Let\'s go with this version.', timestamp: m(36), conversationUrl: 'https://chatgpt.com/c/logo-conv' } as any,

    // Separate branch: Contract on Claude
    { id: 'd14', userId: 'demo', platform: 'claude', model: 'Claude Sonnet', type: 'prompt', content: 'Draft a SaaS subscription agreement template for a B2B legal tech product. Include data processing sections.', timestamp: m(45), conversationUrl: 'https://claude.ai/chat/contract-conv' } as any,
    { id: 'd15', userId: 'demo', platform: 'claude', model: 'Claude Sonnet', type: 'response', content: 'SAAS SUBSCRIPTION AGREEMENT\n\nThis Agreement is entered into as of [DATE]...\nSection 1. Definitions...', timestamp: m(47), conversationUrl: 'https://claude.ai/chat/contract-conv' } as any,
    { id: 'd16', userId: 'demo', platform: 'claude', model: 'Claude Sonnet', type: 'prompt', content: 'Add a Mexican law governing clause (LFPDPPP compliance) and make the arbitration section reference ICC Mexico.', timestamp: m(50), conversationUrl: 'https://claude.ai/chat/contract-conv' } as any,
    { id: 'd17', userId: 'demo', platform: 'claude', model: 'Claude Sonnet', type: 'response', content: 'Updated with LFPDPPP data protection compliance clause and ICC Mexico arbitration provisions...', timestamp: m(52), conversationUrl: 'https://claude.ai/chat/contract-conv' } as any,
  ];
}
