import { NextRequest, NextResponse } from 'next/server';
import type { Interaction, ContributionAnalysis } from '@/lib/types';

/**
 * POST /api/analyze
 * Sends project interactions to Claude API for contribution analysis.
 * Returns: ContributionAnalysis with USCO categorization + authorship justification.
 */
export async function POST(req: NextRequest) {
  try {
    const { projectId, interactions }: { projectId: string; interactions: Interaction[] } =
      await req.json();

    if (!interactions?.length) {
      return NextResponse.json({ error: 'No interactions provided' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    // Build the analysis prompt
    const systemPrompt = `You are HumanProof's legal analysis engine. Analyze a series of human-AI interactions and produce a contribution analysis for copyright registration under the USCO framework.

For each interaction, categorize the human contribution as one or more of:
- SELECTION: The human accepted, rejected, or chose among AI outputs
- COORDINATION: The human combined outputs from multiple sessions or platforms
- ARRANGEMENT: The human ordered, structured, or composed outputs into a whole
- MODIFICATION: The human iterated, edited, or refined AI outputs
- EXPRESSIVE_INPUT: The human provided original creative content as input to the AI

Then produce an authorship justification narrative that explains:
1. How the human directed the creative project
2. Evidence of creative intent and decision-making
3. The role of AI as a tool, not a creator
4. How contributions map to USCO requirements

Respond in JSON matching this schema:
{
  "contributions": [{ "type": string, "description": string, "interactionIds": string[], "strength": "strong"|"moderate"|"weak" }],
  "authorshipJustification": string
}`;

    const userPrompt = `Analyze these ${interactions.length} interactions for project "${projectId}":\n\n${JSON.stringify(interactions, null, 2)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[HumanProof API] Claude API error:', err);
      return NextResponse.json({ error: 'AI analysis failed' }, { status: 502 });
    }

    const result = await response.json();
    const content = result.content?.[0]?.text;

    // Parse Claude's JSON response
    const jsonMatch = content?.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 502 });
    }

    const analysis = JSON.parse(jsonMatch[0]);

    const contributionAnalysis: ContributionAnalysis = {
      projectId,
      contributions: analysis.contributions,
      authorshipJustification: analysis.authorshipJustification,
      analyzedAt: new Date().toISOString(),
    };

    return NextResponse.json(contributionAnalysis);
  } catch (error) {
    console.error('[HumanProof API] Analysis error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
