import { apiClient } from './client';

// Types
export type RunStatus = 'running' | 'done' | 'error' | 'canceled';
export type RunSource = 'ssh' | 'terminal' | 'manual' | 'n8n' | 'api';
export type AgentType = 'main' | 'Explore' | 'Plan' | 'general-purpose' | string;

export interface Run {
  id: string;
  session_id: string;
  source: RunSource;
  status: RunStatus;
  title: string | null;
  cwd: string;
  started_at: number;
  ended_at: number | null;
  n8n_execution_id: string | null;
  parent_run_id: string | null;
  agent_type: AgentType;
  token_input: number;
  token_output: number;
  model: string | null;
  metadata: string | null;
  children?: Run[];
  events_count?: number;
  last_event?: Event | null;
}

export interface Event {
  id: number;
  run_id: string;
  type: string;
  tool_name: string | null;
  payload: string | null;
  created_at: number;
}

export interface RunsResponse {
  runs: Run[];
  running_count: number;
  total_count: number;
}

export interface EventsResponse {
  events: Event[];
}

// AI Factory Step Tracking Types
export type AIFactoryStep = 'PREPARE' | 'EXECUTE' | 'CLEANUP';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface StepPayload {
  workflow: string;
  step: AIFactoryStep;
  substep?: string;
  description: string;
  task_id: string;
}

export interface AIFactoryState {
  task_id: string;
  steps: Record<AIFactoryStep, StepStatus>;
  currentStep: AIFactoryStep | null;
  substeps: Array<{
    name: string;
    description: string;
    status: StepStatus;
    timestamp: number;
  }>;
}

// API functions
export const claudeMonitorApi = {
  // Get all runs
  getRuns: async () => {
    const response = await apiClient.get<RunsResponse>('/v1/claude-monitor/runs');
    return response.data;
  },

  // Get events for a specific run
  getEvents: async (runId: string, limit: number = 100) => {
    const response = await apiClient.get<EventsResponse>(
      `/v1/claude-monitor/runs/${runId}/events`,
      { params: { limit } }
    );
    return response.data;
  },

  // Kill a running session
  killRun: async (runId: string) => {
    await apiClient.post(`/v1/claude-monitor/runs/${runId}/kill`);
  },

  // Delete a run
  deleteRun: async (runId: string) => {
    await apiClient.delete(`/v1/claude-monitor/runs/${runId}`);
  },
};
