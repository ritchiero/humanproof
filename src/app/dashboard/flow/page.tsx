'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { getLogsByUser, getProjectsByUser, getAllLogs, getAllProjects } from '@/lib/firestore';
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

const PLATFORM_COLORS: Record<string, { bg: string; border: string; text: string; line: string; badge: string }> = {
  chatgpt: { bg: '#dcfce7', border: '#16a34a', text: '#166534', line: '#22c55e', badge: '#10b981' },
  claude: { bg: '#fff7ed', border: '#ea580c', text: '#9a3412', line: '#f97316', badge: '#f97316' },
  midjourney: { bg: '#dbeafe', border: '#2563eb', text: '#1e40af', line: '#3b82f6', badge: '#3b82f6' },
  figma: { bg: '#f3e8ff', border: '#9333ea', text: '#6b21a8', line: '#a855f7', badge: '#a855f7' },
  manual: { bg: '#f1f5f9', border: '#64748b', text: '#334155', line: '#94a3b8', badge: '#64748b' },
};

const PLATFORM_LOGOS: Record<string, string> = {
  claude: 'https://ik.imagekit.io/lawgic/claude-logo.svg',
  chatgpt: 'https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg',
  midjourney: 'https://upload.wikimedia.org/wikipedia/commons/e/e6/Midjourney_Emblem.png',
};

const BRANCH_COLORS = {
  revision: '#a855f7', // purple for revision branches
  platformSwitch: '#ea580c', // orange for platform switches
  main: '#3b82f6', // blue for main branch
};

const NODE_W = 280;
const NODE_H = 64;
const ROW_H = 110; // vertical spacing between rows
const TRACK_W = 320; // horizontal spacing between tracks (each track is 320px from center)
const CENTER_X = 500; // center of the trunk
const PADDING_TOP = 60;

// ── USCO Work Type Classification ────────────────────────────────

type USCOWorkType = 'literary' | 'visual' | 'audiovisual' | 'musical' | 'architectural' | 'compilation' | 'derivative';

const USCO_WORK_TYPES: Record<USCOWorkType, { label: string; icon: string; description: string }> = {
  literary:       { label: 'Literary Work', icon: '📄', description: 'Text, code, articles, scripts, documentation' },
  visual:         { label: 'Pictorial, Graphic & Sculptural', icon: '🎨', description: 'Images, logos, illustrations, UI designs' },
  audiovisual:    { label: 'Audiovisual Work', icon: '🎬', description: 'Videos, animations, interactive media' },
  musical:        { label: 'Musical Work', icon: '🎵', description: 'Compositions, sound recordings, audio' },
  architectural:  { label: 'Architectural Work', icon: '🏛️', description: 'Building designs, spatial layouts' },
  compilation:    { label: 'Compilation', icon: '📚', description: 'Curated collection of pre-existing materials' },
  derivative:     { label: 'Derivative Work', icon: '🔄', description: 'Transformation or adaptation of existing work' },
};

const USCO_CONTRIB_LABELS: Record<string, { label: string; color: string; description: string }> = {
  SELECTION:        { label: 'Selection', color: '#16a34a', description: 'Choosing, accepting or rejecting AI outputs' },
  COORDINATION:     { label: 'Coordination', color: '#0891b2', description: 'Combining outputs across platforms/sessions' },
  ARRANGEMENT:      { label: 'Arrangement', color: '#ea580c', description: 'Ordering and structuring into a whole' },
  MODIFICATION:     { label: 'Modification', color: '#ca8a04', description: 'Editing, iterating, and refining outputs' },
  EXPRESSIVE_INPUT: { label: 'Expressive Input', color: '#7c3aed', description: 'Original creative direction and ideation' },
};

function classifyWorkType(logs: CaptureLog[]): { primary: USCOWorkType; secondary?: USCOWorkType; confidence: number } {
  const allContent = logs.map(l => (l.content || '').toLowerCase()).join(' ');
  const scores: Record<USCOWorkType, number> = {
    literary: 0, visual: 0, audiovisual: 0, musical: 0, architectural: 0, compilation: 0, derivative: 0,
  };

  // Literary signals
  if (allContent.match(/escrib|write|draft|redact|article|blog|post|text|paragraph|essay|report|document|contrat|contract|legal|brief|memo|email|letter|código|code|script|function|api|component/)) scores.literary += 3;
  if (allContent.match(/```|function|const |import |class |def |return/)) scores.literary += 2;

  // Visual signals
  if (allContent.match(/logo|image|diseñ|design|ilustra|illustrat|icon|banner|poster|graphic|figma|ui |ux |layout|mockup|wireframe|color|palette|font|tipograf|brand/)) scores.visual += 3;
  if (allContent.match(/midjourney|dall-?e|stable diffusion|imagen|generat.*image|\[image/i)) scores.visual += 4;

  // Audiovisual signals
  if (allContent.match(/video|animation|film|movie|clip|motion|render|3d|scene|camera|frame|storyboard/)) scores.audiovisual += 3;

  // Musical signals
  if (allContent.match(/music|song|melody|chord|beat|audio|sound|lyric|rhythm|compose/)) scores.musical += 3;

  // Compilation signals
  const platforms = new Set(logs.map(l => l.platform));
  if (platforms.size >= 3) scores.compilation += 2;
  if (allContent.match(/combin|compil|collect|gather|curate|junt|recopil/)) scores.compilation += 2;

  // Derivative signals
  if (allContent.match(/adapt|transform|translat|traduc|version|remake|rewrite|basado en|based on/)) scores.derivative += 2;

  // Sort by score
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]) as [USCOWorkType, number][];
  const primary = sorted[0];
  const secondary = sorted[1][1] > 1 ? sorted[1] : undefined;
  const maxScore = Math.max(...Object.values(scores));
  const confidence = maxScore > 0 ? Math.min(95, 50 + maxScore * 8) : 30;

  return { primary: primary[0], secondary: secondary?.[0], confidence };
}

function assessCopyrightability(nodes: FlowNode[]): { strength: 'strong' | 'moderate' | 'weak'; score: number; factors: string[] } {
  const humanNodes = nodes.filter(n => n.stage !== 'response');
  const totalNodes = nodes.length;
  const humanRatio = totalNodes > 0 ? humanNodes.length / totalNodes : 0;
  const factors: string[] = [];
  let score = 0;

  // Factor 1: Human contribution ratio
  if (humanRatio >= 0.4) { score += 30; factors.push('High human-to-AI interaction ratio'); }
  else if (humanRatio >= 0.2) { score += 15; factors.push('Moderate human contribution'); }
  else { score += 5; factors.push('Low direct human input detected'); }

  // Factor 2: Diversity of creative stages
  const uniqueStages = new Set(humanNodes.map(n => n.stage));
  if (uniqueStages.size >= 4) { score += 25; factors.push('Diverse creative contributions (selection, arrangement, modification, expression)'); }
  else if (uniqueStages.size >= 2) { score += 15; factors.push('Multiple types of creative contribution'); }
  else { score += 5; }

  // Factor 3: Multi-platform coordination
  const platforms = new Set(nodes.map(n => n.log.platform));
  if (platforms.size >= 3) { score += 20; factors.push('Cross-platform coordination across ' + platforms.size + ' tools'); }
  else if (platforms.size >= 2) { score += 10; factors.push('Multi-platform workflow'); }

  // Factor 4: Iterative refinement
  const edits = humanNodes.filter(n => ['editing', 'correction', 'refinement'].includes(n.stage));
  if (edits.length >= 3) { score += 15; factors.push('Substantial iterative refinement (' + edits.length + ' editing rounds)'); }
  else if (edits.length >= 1) { score += 8; factors.push('Evidence of human editing'); }

  // Factor 5: Selection/validation
  const selections = humanNodes.filter(n => ['selection', 'validation'].includes(n.stage));
  if (selections.length >= 2) { score += 10; factors.push('Active selection and approval decisions'); }

  const strength = score >= 60 ? 'strong' : score >= 35 ? 'moderate' : 'weak';
  return { strength, score: Math.min(100, score), factors };
}
const DOT_RADIUS = 8; // 16px diameter dots

// ── Creative Stages ──────────────────────────────────────────────

type CreativeStage =
  | 'ideation' | 'direction' | 'exploration' | 'selection'
  | 'editing' | 'correction' | 'combination' | 'refinement'
  | 'validation' | 'response';

const STAGE_CONFIG: Record<CreativeStage, { emoji: string; color: string; bg: string; usco: string }> = {
  'ideation':    { emoji: '💡', color: '#7c3aed', bg: '#f5f3ff', usco: 'EXPRESSIVE_INPUT' },
  'direction':   { emoji: '🎯', color: '#2563eb', bg: '#eff6ff', usco: 'EXPRESSIVE_INPUT' },
  'exploration': { emoji: '🔍', color: '#0891b2', bg: '#ecfeff', usco: 'COORDINATION' },
  'selection':   { emoji: '✓',  color: '#16a34a', bg: '#f0fdf4', usco: 'SELECTION' },
  'editing':     { emoji: '✏️', color: '#ca8a04', bg: '#fefce8', usco: 'MODIFICATION' },
  'correction':  { emoji: '🔧', color: '#dc2626', bg: '#fef2f2', usco: 'MODIFICATION' },
  'combination': { emoji: '🧩', color: '#9333ea', bg: '#faf5ff', usco: 'COORDINATION' },
  'refinement':  { emoji: '✨', color: '#ea580c', bg: '#fff7ed', usco: 'ARRANGEMENT' },
  'validation':  { emoji: '✅', color: '#059669', bg: '#ecfdf5', usco: 'SELECTION' },
  'response':    { emoji: '🤖', color: '#6b7280', bg: '#f9fafb', usco: '' },
};

function inferIsHumanPrompt(log: CaptureLog): boolean {
  const text = (log.content || '').trim();
  // Explicit type wins
  if (log.type === 'prompt') return true;
  if (log.type === 'response') {
    // But if content looks like a human instruction, override
    const lower = text.toLowerCase();
    const len = text.length;
    // Short messages are likely prompts
    if (len < 200) {
      // Questions
      if (text.includes('?') || lower.startsWith('qué') || lower.startsWith('cómo') || lower.startsWith('what') || lower.startsWith('how') || lower.startsWith('can you')) return true;
      // Instructions
      if (lower.match(/^(haz|hazme|crea|genera|escribe|write|create|make|build|design|draft|dame|give me|show me|manda|pon|agrega|add|cambia|change|fix|arregl)/)) return true;
      // Very short = likely prompt
      if (len < 80) return true;
    }
    return false;
  }
  // No type field — use heuristics
  const len = text.length;
  if (len < 150) return true; // short = human
  if (text.includes('```') || text.split('\n').length > 10) return false; // code/structured = AI
  if (len > 500) return false; // long = AI response
  return len < 250; // medium = probably human
}

function detectStage(log: CaptureLog, index: number, allLogs: CaptureLog[]): CreativeStage {
  if (!inferIsHumanPrompt(log)) return 'response';
  const text = (log.content || '').toLowerCase();
  if (text.match(/combin|junt|merg|integr|une|mezcl|from.*and|junto con|final version|versión final/)) return 'combination';
  if (text.match(/me gusta|i like|prefiero|prefer|elijo|choose|el \d|option \d|concepto \d|let'?s go with/)) return 'selection';
  if (text.match(/error|bug|fix|arregl|correg|wrong|mal|equivoc|no funciona/)) return 'correction';
  if (text.match(/perfect|listo|aprobad|approved|looks good|está bien|go ahead|ship it|así está bien|confirmo/)) return 'validation';
  if (text.match(/cambia|change|modific|edit|replac|reemplaz|swap|quita|remove|agrega|add|pon|put/)) return 'editing';
  if (text.match(/más|more|menos|less|mejor|better|pero |hazlo|make it|adjust|tweak|sutil|slight|un poco/)) return 'refinement';
  if (text.match(/estilo|style|tono|tone|color|palette|font|tipograf|layout|diseño|format|estructura/)) return 'direction';
  if (text.match(/variac|variation|altern|option|opcion|dame \d|give me \d|explor|qué tal si|what if|prueba|try|imagina|otra/)) return 'exploration';
  const sameConv = allLogs.filter((l) => (l as any).conversationUrl === (log as any).conversationUrl && l.type === 'prompt');
  const isFirst = sameConv.length === 0 || sameConv[0]?.id === log.id;
  if (isFirst) return 'ideation';
  return 'direction';
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
        if (!auth) { setLoading(false); return; }
        const unsub = auth.onAuthStateChanged(async (u) => {
          if (!u) { router.push('/'); return; }
          try {
            let [l, p] = await Promise.all([getLogsByUser(u.uid), getProjectsByUser(u.uid)]);
            // Fallback: load all if no user-specific data
            if (l.length === 0) l = await getAllLogs();
            if (p.length === 0) p = await getAllProjects();
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
      if (node.stage === 'combination') {
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
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + scroll = zoom
      setZoom(z => Math.min(2, Math.max(0.2, z + (e.deltaY > 0 ? -0.05 : 0.05))));
    } else {
      // Normal scroll = pan
      setPan(p => ({
        x: p.x - e.deltaX * 2.5,
        y: p.y - e.deltaY * 2.5,
      }));
    }
  };

  // ── Render helpers ─────────────────────────────────────────────

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Render SVG: main vertical line, branch curves, and dots
  function renderSVGLayer() {
    const lines = [];
    const dots = [];

    // Main vertical line (trunk) — solid blue #3b82f6, 3px, center at 50% width
    const mainNodes = nodes.filter(n => n.track === 0);
    if (mainNodes.length > 0) {
      const firstMainY = mainNodes[0].y + NODE_H / 2;
      const lastMainY = mainNodes[mainNodes.length - 1].y + NODE_H / 2;
      lines.push(
        <line
          key="main-trunk"
          x1={CENTER_X}
          y1={firstMainY}
          x2={CENTER_X}
          y2={lastMainY}
          stroke={BRANCH_COLORS.main}
          strokeWidth={3}
          opacity={1}
        />
      );
    }

    // Branch lines with curves
    for (const edge of edges) {
      if (edge.type === 'sequential' || !nodeById.get(edge.from) || !nodeById.get(edge.to)) continue;

      const from = nodeById.get(edge.from)!;
      const to = nodeById.get(edge.to)!;

      // Only draw branch/merge lines here (curved paths)
      if (from.track === to.track) continue;

      const x1 = CENTER_X + from.track * TRACK_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = CENTER_X + to.track * TRACK_W;
      const y2 = to.y + NODE_H / 2;

      // Determine color based on edge type
      let lineColor = BRANCH_COLORS.revision;
      if (edge.type === 'cross-platform') {
        lineColor = BRANCH_COLORS.platformSwitch;
      } else if (edge.type === 'merge') {
        lineColor = BRANCH_COLORS.revision;
      }

      // Cubic bezier curve for branch
      const midY = (y1 + y2) / 2;
      const cp1x = x1 + (x2 - x1) * 0.3;
      const cp1y = y1 + (midY - y1) * 0.5;
      const cp2x = x2 - (x2 - x1) * 0.3;
      const cp2y = y2 - (y2 - midY) * 0.5;
      const path = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
      lines.push(
        <path
          key={`branch-${edge.from}-${edge.to}`}
          d={path}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          opacity={0.6}
        />
      );
    }

    // Add straight vertical lines for each branch track
    const trackNodes = new Map<number, FlowNode[]>();
    for (const n of nodes) {
      const arr = trackNodes.get(n.track) || [];
      arr.push(n);
      trackNodes.set(n.track, arr);
    }

    for (const [track, tNodes] of trackNodes) {
      if (track === 0 || tNodes.length < 2) continue;

      const x = CENTER_X + track * TRACK_W;
      const firstY = tNodes[0].y + NODE_H / 2;
      const lastY = tNodes[tNodes.length - 1].y + NODE_H / 2;

      // Draw vertical line for this branch
      lines.push(
        <line
          key={`track-${track}`}
          x1={x}
          y1={firstY}
          x2={x}
          y2={lastY}
          stroke={BRANCH_COLORS.revision}
          strokeWidth={2}
          opacity={0.4}
        />
      );
    }

    // Dots on nodes — 16px diameter (8px radius), white 3px stroke
    for (const node of nodes) {
      const dotX = CENTER_X + node.track * TRACK_W;
      const dotY = node.y + NODE_H / 2;
      const platform = node.log.platform;
      const colors = PLATFORM_COLORS[platform] || PLATFORM_COLORS.manual;

      dots.push(
        <circle
          key={`dot-${node.id}`}
          cx={dotX}
          cy={dotY}
          r={DOT_RADIUS}
          fill={colors.badge}
          stroke="#ffffff"
          strokeWidth={3}
          style={{ cursor: 'pointer' }}
          onClick={() => setSelectedNode(node.id === selectedNode?.id ? null : node)}
        />
      );
    }

    return [lines, dots];
  }

  // Render HTML cards positioned alongside the flow
  function renderCards() {
    return nodes.map((node) => {
      const colors = PLATFORM_COLORS[node.log.platform] || PLATFORM_COLORS.manual;
      const stageConf = STAGE_CONFIG[node.stage];
      const isSelected = selectedNode?.id === node.id;
      const contentPreview = (node.log.content || '').substring(0, 60);
      const time = new Date(node.log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const stageLabel = node.stage.charAt(0).toUpperCase() + node.stage.slice(1);

      // Cards positioned right of main branch, alternating left/right for side branches
      let cardLeft: number;
      if (node.track === 0) {
        // Main branch: card to the right of the dot
        cardLeft = CENTER_X + DOT_RADIUS + 20;
      } else if (node.track > 0) {
        // Right branches: card to the right
        cardLeft = CENTER_X + node.track * TRACK_W + DOT_RADIUS + 20;
      } else {
        // Left branches: card to the left
        cardLeft = CENTER_X + node.track * TRACK_W - DOT_RADIUS - 20 - NODE_W;
      }

      return (
        <div
          key={`card-${node.id}`}
          style={{
            position: 'absolute',
            top: node.y,
            left: cardLeft,
            width: NODE_W,
            background: isSelected ? stageConf.bg : '#ffffff',
            borderRadius: 12,
            border: `1px solid ${isSelected ? stageConf.color : '#e2e8f0'}`,
            boxShadow: isSelected ? `0 4px 12px ${stageConf.color}20` : '0 1px 3px rgba(0,0,0,0.08)',
            cursor: 'pointer',
            overflow: 'hidden',
            transition: 'all 0.2s',
          }}
          onClick={() => setSelectedNode(node.id === selectedNode?.id ? null : node)}
        >
          {/* Left color accent bar */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: colors.badge,
          }} />

          {/* Card content */}
          <div style={{ padding: '12px 12px 12px 12px' }}>
            {/* Top row: badges */}
            <div style={{
              display: 'flex',
              gap: 6,
              marginBottom: 8,
              flexWrap: 'wrap',
              fontSize: 9,
              fontWeight: 700,
              lineHeight: '16px',
            }}>
              <span style={{
                background: colors.bg,
                color: colors.text,
                padding: '2px 6px',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                {PLATFORM_LOGOS[node.log.platform] ? (
                  <img src={PLATFORM_LOGOS[node.log.platform]} alt={node.log.platform} style={{ width: 12, height: 12 }} />
                ) : null}
                {node.log.model || node.log.platform.toUpperCase()}
              </span>
              <span style={{
                background: stageConf.bg,
                color: stageConf.color,
                padding: '2px 6px',
                borderRadius: 4,
              }}>
                {stageConf.emoji} {stageLabel}
              </span>
              <span style={{
                marginLeft: 'auto',
                color: '#94a3b8',
                fontSize: 8,
              }}>
                {time}
              </span>
            </div>

            {/* Content preview */}
            <div style={{
              fontSize: 11,
              lineHeight: 1.4,
              color: '#334155',
              marginBottom: 8,
              minHeight: 16,
              wordWrap: 'break-word',
            }}>
              {contentPreview}
              {contentPreview.length === 60 && '...'}
            </div>

            {/* Platform name if logo shown */}
            {PLATFORM_LOGOS[node.log.platform] && (
              <div style={{
                fontSize: 8,
                color: '#94a3b8',
              }}>
                {node.log.platform}
              </div>
            )}
          </div>
        </div>
      );
    });
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
              background: colors.bg, color: colors.text, display: 'flex', alignItems: 'center', gap: 5 }}>
              {PLATFORM_LOGOS[log.platform] ? (
                <img src={PLATFORM_LOGOS[log.platform]} alt={log.platform} style={{ width: 14, height: 14 }} />
              ) : null}
              {log.model || log.platform.toUpperCase()}
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
            <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{inferIsHumanPrompt(log) ? 'Human Prompt' : 'AI Response'}</div>
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
    if (n.stage !== 'response') acc[n.stage] = (acc[n.stage] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // USCO Classification
  const uscoWorkType = logs.length > 0 ? classifyWorkType(logs) : null;
  const uscoCopyrightability = nodes.length > 0 ? assessCopyrightability(nodes) : null;
  const uscoContribBreakdown = nodes.reduce((acc, n) => {
    const usco = STAGE_CONFIG[n.stage]?.usco;
    if (usco) acc[usco] = (acc[usco] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const [showUSCO, setShowUSCO] = useState(false);

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
    <div style={{ height: '100vh', width: '100vw', overflow: 'hidden', background: '#f8fafc',
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

          <button
            onClick={() => setShowUSCO(!showUSCO)}
            style={{
              height: 30, padding: '0 14px', fontSize: 11, fontWeight: 700,
              background: showUSCO ? '#eff6ff' : '#f8fafc',
              color: showUSCO ? '#2563eb' : '#64748b',
              border: showUSCO ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
              borderRadius: 8, cursor: 'pointer',
            }}>
            ⚖️ USCO
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

      {/* USCO Classification Panel */}
      {showUSCO && uscoWorkType && uscoCopyrightability && (
        <div style={{
          position: 'fixed', top: 60, left: 20, width: 340, zIndex: 40,
          background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)', padding: 24,
          fontFamily: 'Inter, -apple-system, sans-serif',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>⚖️ USCO Classification</h3>
            <button onClick={() => setShowUSCO(false)}
              style={{ background: '#f1f5f9', border: 'none', width: 24, height: 24, borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#64748b' }}>✕</button>
          </div>

          {/* Work Type */}
          <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 10, border: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>Work Type</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 20 }}>{USCO_WORK_TYPES[uscoWorkType.primary].icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{USCO_WORK_TYPES[uscoWorkType.primary].label}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{USCO_WORK_TYPES[uscoWorkType.primary].description}</div>
              </div>
            </div>
            {uscoWorkType.secondary && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                Also: {USCO_WORK_TYPES[uscoWorkType.secondary].icon} {USCO_WORK_TYPES[uscoWorkType.secondary].label}
              </div>
            )}
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
              Confidence: {uscoWorkType.confidence}%
              <div style={{ width: '100%', height: 3, background: '#e2e8f0', borderRadius: 2, marginTop: 3 }}>
                <div style={{ width: `${uscoWorkType.confidence}%`, height: 3, background: '#3b82f6', borderRadius: 2 }} />
              </div>
            </div>
          </div>

          {/* Copyrightability Assessment */}
          <div style={{ marginBottom: 16, padding: 12, background: uscoCopyrightability.strength === 'strong' ? '#f0fdf4' : uscoCopyrightability.strength === 'moderate' ? '#fffbeb' : '#fef2f2', borderRadius: 10, border: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>Copyrightability</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{
                fontSize: 22, fontWeight: 800,
                color: uscoCopyrightability.strength === 'strong' ? '#16a34a' : uscoCopyrightability.strength === 'moderate' ? '#ca8a04' : '#dc2626',
              }}>{uscoCopyrightability.score}%</div>
              <div>
                <div style={{
                  fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                  color: uscoCopyrightability.strength === 'strong' ? '#16a34a' : uscoCopyrightability.strength === 'moderate' ? '#ca8a04' : '#dc2626',
                }}>{uscoCopyrightability.strength === 'strong' ? 'Strong Case' : uscoCopyrightability.strength === 'moderate' ? 'Moderate Case' : 'Weak Case'}</div>
                <div style={{ fontSize: 10, color: '#64748b' }}>Human authorship assessment</div>
              </div>
            </div>
            {uscoCopyrightability.factors.slice(0, 4).map((f, i) => (
              <div key={i} style={{ fontSize: 10, color: '#64748b', marginBottom: 2, paddingLeft: 8, borderLeft: '2px solid #e2e8f0' }}>
                {f}
              </div>
            ))}
          </div>

          {/* Contribution Breakdown */}
          <div>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>Human Contribution Breakdown</div>
            {Object.entries(uscoContribBreakdown).filter(([k]) => k).map(([key, count]) => {
              const conf = USCO_CONTRIB_LABELS[key];
              if (!conf) return null;
              const total = Object.values(uscoContribBreakdown).reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={key} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: conf.color }}>{conf.label}</span>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>{count} ({pct}%)</span>
                  </div>
                  <div style={{ width: '100%', height: 4, background: '#f1f5f9', borderRadius: 2 }}>
                    <div style={{ width: `${pct}%`, height: 4, background: conf.color, borderRadius: 2, transition: 'width 0.3s' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          marginTop: 52, height: 'calc(100vh - 52px)', overflow: 'hidden',
          background: '#f8fafc',
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
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              overflow: 'auto',
            }}
          >
            {/* SVG layer for lines and dots */}
            <svg
              ref={svgRef}
              width={maxX + 100}
              height={maxY + 100}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              {renderSVGLayer()}
            </svg>

            {/* HTML layer for cards */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: maxX + 100,
                height: maxY + 100,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              {renderCards()}
            </div>
          </div>
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
