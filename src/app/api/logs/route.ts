import { NextRequest, NextResponse } from 'next/server';
import { collection, doc, setDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// In-memory cache (supplements Firestore)
const logsStore: any[] = [];
let projectsStore: any[] = [];
let stagesStore: Record<string, string> = {};

async function persistLogToFirestore(log: any) {
  if (!db) return;
  try {
    await setDoc(doc(db, 'logs', log.id), log);
  } catch (e) {
    console.error('[logs] Firestore persist error:', e);
  }
}

async function persistProjectToFirestore(project: any) {
  if (!db) return;
  try {
    await setDoc(doc(db, 'projects', project.id), project);
  } catch (e) {
    console.error('[logs] Firestore project persist error:', e);
  }
}

export async function GET() {
  // If in-memory is empty, load from Firestore
  if (logsStore.length === 0 && db) {
    try {
      const q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const data = d.data();
        if (!logsStore.find((l) => l.id === data.id)) {
          logsStore.push(data);
        }
      }
    } catch (e) {
      console.error('[logs] Firestore load error:', e);
    }
  }

  // Also load projects from Firestore if empty
  if (projectsStore.length === 0 && db) {
    try {
      const pSnap = await getDocs(collection(db, 'projects'));
      for (const d of pSnap.docs) {
        const data = d.data();
        if (!projectsStore.find((p: any) => p.id === data.id)) {
          projectsStore.push(data);
        }
      }
    } catch (e) {
      console.error('[logs] Firestore projects load error:', e);
    }
  }

  return NextResponse.json({
    logs: logsStore,
    projects: projectsStore,
    stages: stagesStore,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Save a single log
    if (body.type === 'log' && body.data) {
      if (!logsStore.find((l) => l.id === body.data.id)) {
        logsStore.push(body.data);
      }
      // Persist to Firestore
      persistLogToFirestore(body.data);
      return NextResponse.json({ ok: true, count: logsStore.length });
    }

    // Bulk sync logs
    if (body.type === 'sync' && body.logs) {
      for (const log of body.logs) {
        if (!logsStore.find((l) => l.id === log.id)) {
          logsStore.push(log);
        }
        // Persist each to Firestore
        persistLogToFirestore(log);
      }
      return NextResponse.json({ ok: true, count: logsStore.length });
    }

    // Save projects (from auto-detect)
    if (body.type === 'projects' && body.projects) {
      projectsStore = body.projects;
      for (const p of body.projects) {
        if (p.id) persistProjectToFirestore(p);
      }
      return NextResponse.json({ ok: true });
    }

    // Save stages (from auto-classify)
    if (body.type === 'stages' && body.stages) {
      stagesStore = { ...stagesStore, ...body.stages };
      return NextResponse.json({ ok: true });
    }

    // Clear all
    if (body.type === 'clear') {
      logsStore.length = 0;
      projectsStore = [];
      stagesStore = {};
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
