export interface AutomationStep {
  id: string;
  type: string;
  actionVersion: number;
  config: any;
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  shortcut: string;
  failurePolicy: 'stop';
  acknowledgedRiskHash?: string;
  createdAt: string;
  updatedAt: string;
  steps: AutomationStep[];
}

export interface AutomationFile {
  schemaVersion: 1;
  automations: Automation[];
}

export interface AutomationRunResult {
  automationId: string;
  status: 'complete' | 'failed' | 'skipped';
  stepIndex?: number;
  error?: string;
}
