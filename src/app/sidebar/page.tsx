'use client';

import { useState, useEffect } from 'react';
import type { Interaction } from '@/lib/types';

/**
 * Sidebar page — loaded inside Chrome extension's side panel via iframe.
 * Receives interaction data via postMessage from the content script.
 */
export default function SidebarPage() {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [activeTab, setActiveTab] = useState<'logs' | 'projects' | 'report'>('logs');

  useEffect(() => {
    // Listen for messages from the extension
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'INTERACTION_CAPTURED') {
        setInteractions((prev) => [...prev, event.data.payload as Interaction]);
      }
      if (event.data?.type === 'LOGS_RESPONSE') {
        setInteractions(event.data.payload as Interaction[]);
      }
    };
    window.addEventListener('message', handler);

    // Request existing logs on mount
    window.parent?.postMessage({ type: 'REQUEST_LOGS' }, '*');

    return () => window.removeEventListener('message', handler);
  }, []);

  const tabs = ['logs', 'projects', 'report'] as const;

  return (
    <div className="min-h-screen bg-hp-primary p-4">
      <header className="mb-4">
        <h1 className="text-lg font-bold">
          Human<span className="text-hp-accent">Proof</span>
        </h1>
        <p className="text-xs text-gray-400">AI Authorship Evidence Logger</p>
      </header>

      {/* Tabs */}
      <nav className="flex gap-2 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs rounded-md font-medium capitalize transition ${
              activeTab === tab
                ? 'bg-hp-accent text-white'
                : 'bg-hp-surface text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* Content */}
      {activeTab === 'logs' && <LogsView interactions={interactions} />}
      {activeTab === 'projects' && (
        <p className="text-gray-500 text-sm">
          Projects appear after AI analysis groups your interactions.
        </p>
      )}
      {activeTab === 'report' && (
        <p className="text-gray-500 text-sm">
          Select a project to generate an evidence report.
        </p>
      )}
    </div>
  );
}

function LogsView({ interactions }: { interactions: Interaction[] }) {
  if (interactions.length === 0) {
    return (
      <div className="text-center text-gray-500 text-sm py-12">
        No interactions captured yet.
        <br />
        <span className="text-xs">Start using an AI platform — HumanProof logs automatically.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {interactions.map((ix) => (
        <div key={ix.id} className="p-3 bg-hp-surface rounded-lg">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-semibold text-hp-accent uppercase">{ix.platform}</span>
            <span className="text-[10px] text-gray-500">
              {new Date(ix.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-xs text-gray-300 line-clamp-2">{ix.prompt}</p>
        </div>
      ))}
    </div>
  );
}
