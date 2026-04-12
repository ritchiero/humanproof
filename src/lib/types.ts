// ============================================
// HumanProof — Core Types
// ============================================

export type Platform = 'chatgpt' | 'claude' | 'midjourney' | 'manual';

/** USCO contribution categories */
export type ContributionType =
  | 'selection'
  | 'coordination'
  | 'arrangement'
  | 'modification'
  | 'expressive_input';

export type Jurisdiction = 'USCO' | 'INDAUTOR' | 'EUIPO' | 'WIPO';
export type ReportLayout = 'timeline' | 'narrative' | 'summary';

/** A single human-AI interaction */
export interface Interaction {
  id: string;
  timestamp: string;
  platform: Platform;
  model: string;
  prompt: string;
  response: string;
  parameters?: Record<string, unknown>;
  screenshotUrl?: string;
  projectId?: string;
}

/** Manual entry for off-platform work */
export interface ManualEntry {
  id: string;
  timestamp: string;
  description: string;
  toolUsed: string;
  evidenceUrl?: string;
  projectId?: string;
}

/** A detected project grouping */
export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  interactions: string[];
  manualEntries: string[];
  platforms: Platform[];
  models: string[];
}

/** AI-generated contribution analysis */
export interface ContributionAnalysis {
  projectId: string;
  contributions: {
    type: ContributionType;
    description: string;
    interactionIds: string[];
    strength: 'strong' | 'moderate' | 'weak';
  }[];
  authorshipJustification: string;
  analyzedAt: string;
}

/** The final evidence report */
export interface EvidenceReport {
  id: string;
  projectId: string;
  author: { name: string; email: string };
  jurisdiction: Jurisdiction;
  language: string;
  layout: ReportLayout;
  projectSummary: string;
  chainOfCustody: Interaction[];
  contributionAnalysis: ContributionAnalysis;
  manualEntries: ManualEntry[];
  generatedAt: string;
  hash: string;
}

/** Messages between extension ↔ background */
export type MessageType =
  | 'INTERACTION_CAPTURED'
  | 'SIDEBAR_TOGGLE'
  | 'REQUEST_LOGS'
  | 'LOGS_RESPONSE'
  | 'GENERATE_REPORT'
  | 'REPORT_READY'
  | 'PROJECT_DETECTED';

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}
