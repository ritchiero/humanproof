export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  defaultJurisdiction: 'USCO' | 'INDAUTOR' | 'EUIPO' | 'WIPO';
  createdAt: string; // ISO 8601
}

export interface CaptureLog {
  id: string;
  userId: string;
  projectId?: string;
  platform: 'chatgpt' | 'claude' | 'midjourney' | 'figma' | 'manual';
  model?: string;
  type: 'prompt' | 'response' | 'selection' | 'manual_entry';
  content: string;
  screenshotUrl?: string;
  timestamp: string; // ISO 8601
  contributionType?: ContributionType;
  metadata?: Record<string, any>;
}

export type ContributionType =
  | 'selection'
  | 'coordination'
  | 'arrangement'
  | 'modification'
  | 'expressive_input';

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  status: 'active' | 'archived';
  platforms: string[];
  contributionSummary?: Record<ContributionType, number>;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  id: string;
  userId: string;
  projectId: string;
  jurisdiction: string;
  language: string;
  layout: 'timeline' | 'narrative' | 'summary';
  hash: string;
  generatedAt: string;
  pdfUrl?: string;
  authorshipJustification?: string;
}

export type SupportedPlatform = 'chatgpt' | 'claude' | 'midjourney' | 'figma';

export const PLATFORM_URLS: Record<SupportedPlatform, string[]> = {
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  claude: ['claude.ai'],
  midjourney: ['discord.com'],
  figma: ['figma.com'],
};
