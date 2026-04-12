import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { CaptureLog } from '@/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { logs, action } = await req.json() as { logs: CaptureLog[]; action: 'detect_projects' | 'categorize' | 'justify' };

    if (action === 'detect_projects') {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are HumanProof's AI analysis engine. You analyze logs of human-AI interactions to detect distinct creative projects.

Given a list of interaction logs (prompts and responses across AI platforms), group them into distinct projects based on thematic coherence. For each project, provide:
- A descriptive name
- Which log IDs belong to it
- When the project started (first log timestamp)
- Which platforms were used

Respond ONLY in valid JSON with this structure:
{
  "projects": [
    {
      "name": "string",
      "logIds": ["string"],
      "startedAt": "ISO timestamp",
      "platforms": ["string"]
    }
  ]
}`,
        messages: [
          {
            role: 'user',
            content: `Analyze these interaction logs and group them into projects:\n\n${JSON.stringify(logs, null, 2)}`,
          },
        ],
      });

      const text = response.content.find((c) => c.type === 'text')?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return NextResponse.json(parsed);
    }

    if (action === 'categorize') {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are HumanProof's AI analysis engine. You categorize human contributions in AI-assisted creative work using the USCO (U.S. Copyright Office) authorship framework.

For each interaction log, determine the contribution type:
- "selection": The human accepted or rejected AI outputs
- "coordination": The human combined outputs from multiple platforms or sessions
- "arrangement": The human ordered, structured, or composed outputs into a whole
- "modification": The human iterated, edited, or refined AI outputs
- "expressive_input": The human provided their own creative content as input to the AI

Respond ONLY in valid JSON:
{
  "categorized": [
    { "logId": "string", "contributionType": "string", "reasoning": "string" }
  ]
}`,
        messages: [
          {
            role: 'user',
            content: `Categorize the human contributions in these logs:\n\n${JSON.stringify(logs, null, 2)}`,
          },
        ],
      });

      const text = response.content.find((c) => c.type === 'text')?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return NextResponse.json(parsed);
    }

    if (action === 'justify') {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are HumanProof's AI analysis engine. You generate authorship justification narratives for AI-assisted creative works.

Given a set of categorized interaction logs for a project, write a professional authorship justification that:
1. Explains how the human directed the creative process
2. Documents evidence of creative intent and decision-making
3. Describes the role of AI as a tool, not the creator
4. Maps contributions to the USCO framework (selection, coordination, arrangement, modification, expressive inputs)
5. Could be included in a copyright registration application

The narrative should be factual, evidence-based, and written in a professional legal tone. It should reference specific interactions as evidence.

Respond ONLY in valid JSON:
{
  "justification": "string (the full narrative)",
  "summary": "string (2-3 sentence summary)",
  "strengthAssessment": "strong | moderate | weak",
  "recommendations": ["string"]
}`,
        messages: [
          {
            role: 'user',
            content: `Generate an authorship justification for this project's interaction logs:\n\n${JSON.stringify(logs, null, 2)}`,
          },
        ],
      });

      const text = response.content.find((c) => c.type === 'text')?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return NextResponse.json(parsed);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Analysis error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
