import { NextRequest, NextResponse } from 'next/server';
import type { Interaction } from '@/lib/types';

/**
 * POST /api/capture
 * Receives interaction data from the Chrome extension content script.
 * Stores to Firebase (or local for now) and returns confirmation.
 */
export async function POST(req: NextRequest) {
  try {
    const interaction: Interaction = await req.json();

    // Validate required fields
    if (!interaction.platform || !interaction.prompt || !interaction.timestamp) {
      return NextResponse.json(
        { error: 'Missing required fields: platform, prompt, timestamp' },
        { status: 400 }
      );
    }

    // Assign ID if missing
    if (!interaction.id) {
      interaction.id = crypto.randomUUID();
    }

    // TODO: Store to Firestore
    // const docRef = await addDoc(collection(db, 'interactions'), interaction);

    console.log('[HumanProof API] Captured interaction:', interaction.id);

    return NextResponse.json({ success: true, id: interaction.id });
  } catch (error) {
    console.error('[HumanProof API] Capture error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
