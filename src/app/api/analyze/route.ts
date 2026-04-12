import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { CaptureLog } from '@/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Model routing: Haiku for fast/cheap tasks, Sonnet for complex reasoning
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

type AnalyzeAction = 'detect_projects' | 'categorize' | 'justify' | 'classify_stages';

export async function POST(req: NextRequest) {
  try {
    const { logs, action } = await req.json() as { logs: CaptureLog[]; action: AnalyzeAction };

    // ── Detect Projects (Sonnet — needs deep reasoning to cluster by theme) ──
    if (action === 'detect_projects') {
      const response = await anthropic.messages.create({
        model: MODEL_SONNET,
        max_tokens: 4096,
        system: `You are HumanProof's AI analysis engine. You analyze logs of human-AI interactions to detect distinct creative projects.

Given a list of interaction logs (prompts and responses across AI platforms), group them into distinct projects based on thematic coherence.

Rules:
- Group logs that clearly belong to the same creative effort, even across different platforms.
- Logs with unrelated topics should be separate projects.
- A single conversation can contain multiple projects if the topic shifts significantly.
- Give each project a short, descriptive working name (3-6 words). Think of it as a folder name.
- Also write a 1-2 sentence description of what the project seems to be about.
- If there are very few logs and it's unclear, still assign a provisional name based on the best guess.

Respond ONLY in valid JSON with this structure:
{
  "projects": [
    {
      "name": "string (short working title)",
      "description": "string (1-2 sentence summary of what this project is about)",
      "logIds": ["string"],
      "startedAt": "ISO timestamp of earliest log",
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

    // ── Classify Stages (Haiku — fast classification per log) ────────────
    if (action === 'classify_stages') {
      // Send only essential data to Haiku to keep it fast and cheap
      const lightweight = logs.map((l) => ({
        id: l.id,
        type: l.type,
        platform: l.platform,
        content: (l.content || '').substring(0, 300), // Truncate for speed
        timestamp: l.timestamp,
      }));

      const response = await anthropic.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 4096,
        system: `You classify human-AI interaction logs into creative stages. For each log, assign ONE stage from this list:

- "ideation": First creative spark, initial concept, starting a new idea
- "direction": Giving specific creative instructions (style, tone, color, layout, format)
- "exploration": Asking for variations, alternatives, options, "what if" scenarios
- "selection": Choosing between options ("I like #3", "prefer this one", "let's go with")
- "editing": Modifying output ("change X", "add Y", "remove Z", "replace")
- "correction": Fixing errors ("bug", "wrong", "doesn't work", "fix this")
- "combination": Merging outputs from different sources/platforms/conversations
- "refinement": Iterating to improve ("make it more X", "less Y", "adjust", "subtle")
- "validation": Approving final result ("perfect", "approved", "looks good", "ship it")
- "response": AI-generated response (not a human contribution)

Rules:
- AI responses (type="response") are ALWAYS "response"
- The first human prompt in a conversation is usually "ideation" unless it references prior work
- Be precise — "direction" vs "editing" depends on whether they're setting style or changing content

Respond ONLY in valid JSON:
{
  "stages": [
    { "id": "log_id", "stage": "stage_name" }
  ]
}`,
        messages: [
          {
            role: 'user',
            content: `Classify each log's creative stage:\n\n${JSON.stringify(lightweight, null, 2)}`,
          },
        ],
      });

      const text = response.content.find((c) => c.type === 'text')?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return NextResponse.json(parsed);
    }

    // ── Categorize USCO Contributions (Haiku — structured classification) ──
    if (action === 'categorize') {
      const lightweight = logs.map((l) => ({
        id: l.id,
        type: l.type,
        platform: l.platform,
        content: (l.content || '').substring(0, 400),
        timestamp: l.timestamp,
      }));

      const response = await anthropic.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 4096,
        system: `You categorize human contributions in AI-assisted creative work using the USCO (U.S. Copyright Office) authorship framework.

For each interaction log, determine the contribution type:
- "selection": The human accepted or rejected AI outputs
- "coordination": The human combined outputs from multiple platforms or sessions
- "arrangement": The human ordered, structured, or composed outputs into a whole
- "modification": The human iterated, edited, or refined AI outputs
- "expressive_input": The human provided their own creative content as input to the AI

Only categorize prompts (type="prompt"), skip responses.

Respond ONLY in valid JSON:
{
  "categorized": [
    { "logId": "string", "contributionType": "string", "reasoning": "string (1 sentence)" }
  ]
}`,
        messages: [
          {
            role: 'user',
            content: `Categorize the human contributions in these logs:\n\n${JSON.stringify(lightweight, null, 2)}`,
          },
        ],
      });

      const text = response.content.find((c) => c.type === 'text')?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return NextResponse.json(parsed);
    }

    // ── Justify Authorship (Sonnet — needs nuanced legal writing) ────────
    if (action === 'justify') {
      const response = await anthropic.messages.create({
        model: MODEL_SONNET,
        max_tokens: 4096,
        system: `You are HumanProof's AI analysis engine. You generate authorship justification narratives for AI-assisted creative works.

Given a set of interaction logs for a project, write a professional authorship justification that:
1. Explains how the human directed the creative process
2. Documents evidence of creative intent and decision-making
3. Describes the role of AI as a tool, not the creator
4. Maps contributions to the USCO framework (selection, coordination, arrangement, modification, expressive inputs)
5. Could be included in a copyright registration application

The narrative should be factual, evidence-based, and written in a professional legal tone. Reference specific interactions as evidence.

Respond ONLY in valid JSON:
{
  "justification": "string (the full narrative, 3-5 paragraphs)",
  "summary": "string (2-3 sentence summary)",
  "strengthAssessment": "strong | moderate | weak",
  "humanContributionPercentage": number (estimated 0-100),
  "keyEvidence": ["string (specific moments that demonstrate authorship)"],
  "recommendations": ["string (how to strengthen the copyright claim)"]
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
