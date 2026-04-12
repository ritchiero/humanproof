import { NextRequest, NextResponse } from 'next/server';

// In-memory store — persists as long as the Next.js server is running.
// For hackathon this is fine. In production, this would be Firestore.
const logsStore: any[] = [];
let projectsStore: any[] = [];
let stagesStore: Record<string, string> = {};

export async function GET() {
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
      // Avoid duplicates
      if (!logsStore.find((l) => l.id === body.data.id)) {
        logsStore.push(body.data);
      }
      return NextResponse.json({ ok: true, count: logsStore.length });
    }

    // Bulk sync logs
    if (body.type === 'sync' && body.logs) {
      for (const log of body.logs) {
        if (!logsStore.find((l) => l.id === log.id)) {
          logsStore.push(log);
        }
      }
      return NextResponse.json({ ok: true, count: logsStore.length });
    }

    // Save projects (from auto-detect)
    if (body.type === 'projects' && body.projects) {
      projectsStore = body.projects;
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
