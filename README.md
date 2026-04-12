# HumanProof — AI Authorship Evidence Logger

Chrome extension + Next.js app that captures human-AI interactions and generates verifiable copyright evidence reports.

## Architecture

```
humanproof-app/
├── src/                    # Next.js App (dashboard + API + sidebar)
│   ├── app/
│   │   ├── page.tsx        # Landing page
│   │   ├── sidebar/        # Sidebar UI (loaded by extension side panel)
│   │   └── api/
│   │       ├── capture/    # POST — receive interactions from extension
│   │       └── analyze/    # POST — Claude AI contribution analysis
│   ├── components/
│   └── lib/
│       ├── types.ts        # Shared types
│       ├── firebase.ts     # Firebase client
│       └── hash.ts         # SHA-256 + report ID
├── extension/              # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── sidebar.html        # Iframe → Next.js /sidebar
│   ├── background.ts       # Service worker
│   ├── content.ts          # DOM capture (ChatGPT, Claude)
│   └── dist/               # Built by tsup (gitignored)
├── next.config.js
├── tailwind.config.ts
└── package.json
```

## Development

```bash
# Install
npm install

# Run Next.js app
npm run dev

# Build extension (separate terminal)
npm run ext:build    # or ext:watch

# Load extension in Chrome
# 1. chrome://extensions → Developer Mode ON
# 2. Load unpacked → select /extension folder
```

## Deploy

```bash
# Vercel (dashboard + API)
vercel

# Then update extension/sidebar.html iframe src to Vercel URL
```

## Stack

Next.js 14 · TypeScript · Tailwind · Firebase · Claude API · tsup · Vercel

## LLM x Law Hackathon #6 — April 12, 2026
