export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  status: 'active' | 'archived';
  platforms?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CaptureLog {
  id: string;
  userId: string;
  platform: string;
  type: 'prompt' | 'response';
  content: string;
  timestamp: string;
  model?: string;
  screenshotUrl?: string;
  hasScreenshot?: boolean;
}
