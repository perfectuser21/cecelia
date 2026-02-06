import { apiClient } from './client';
import type { RunsListResponse, LogsResponse } from '../types/execution-logs';

// Types
export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'needs_info' | 'ready' | 'decomposing' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'P0' | 'P1' | 'P2';
  progress: number;
  metadata?: {
    pending_questions?: PendingQuestion[];
    decompose_notes?: string;
  };
  parent_id?: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
}

export interface PendingQuestion {
  id: string;
  question: string;
  answered: boolean;
  answer: string | null;
}

export interface BrainDailyReport {
  id: string;
  date: string;
  project_id?: string;
  project_name?: string;
  content: any;
  type: 'repo' | 'summary';
  agent: string;
  created_at: string;
  updated_at: string;
}

export interface Reflection {
  id: string;
  type: 'issue' | 'learning' | 'improvement';
  title: string;
  content?: string;
  project_id?: string;
  project_name?: string;
  source_task_id?: string;
  source_goal_id?: string;
  tags?: string[];
  created_at: string;
}

export interface TaskType {
  [key: string]: string | null;
}

// API functions
export const brainApi = {
  // OKR
  getGoal: (id: string) =>
    apiClient.get<Goal>(`/brain/goals/${id}`),

  getGoals: () =>
    apiClient.get<Goal[]>('/tasks/goals'),

  updateGoal: (id: string, data: Partial<Goal>) =>
    apiClient.put(`/brain/action/update-goal`, { goal_id: id, ...data }),

  // OKR Questions
  getQuestions: (goalId: string) =>
    apiClient.get<{ questions: PendingQuestion[] }>(`/brain/okr/${goalId}/questions`),

  addQuestion: (goalId: string, question: string) =>
    apiClient.post(`/brain/okr/${goalId}/question`, { question }),

  answerQuestion: (goalId: string, questionId: string, answer: string) =>
    apiClient.put(`/brain/okr/${goalId}/answer`, { question_id: questionId, answer }),

  // OKR Status
  getOkrStatuses: () =>
    apiClient.get<{ statuses: Record<string, string> }>('/brain/okr/statuses'),

  // Daily Reports
  getDailyReports: (date: string = 'today', type: string = 'all') =>
    apiClient.get<{ reports: BrainDailyReport[] }>('/brain/daily-reports', { params: { date, type } }),

  getDailyReportByDate: (date: string) =>
    apiClient.get<{ reports: BrainDailyReport[] }>(`/brain/daily-reports/${date}`),

  getDailySummary: (date: string) =>
    apiClient.get<{ summary: any }>(`/brain/daily-reports/${date}/summary`),

  // Trigger nightly alignment
  triggerNightly: () =>
    apiClient.post('/brain/nightly/trigger'),

  // Reflections
  getReflections: (params?: { type?: string; project_id?: string; limit?: number }) =>
    apiClient.get<{ reflections: Reflection[] }>('/brain/reflections', { params }),

  createReflection: (data: Omit<Reflection, 'id' | 'created_at'>) =>
    apiClient.post<{ reflection: Reflection }>('/brain/reflections', data),

  // Task Types
  getTaskTypes: () =>
    apiClient.get<{ task_types: TaskType; description: Record<string, string> }>('/brain/task-types'),

  // Task Routing
  routeTask: (taskIdOrType: { task_id?: string; task_type?: string }) =>
    apiClient.post<{ task_type: string; agent: string | null; requires_manual: boolean }>('/brain/route-task', taskIdOrType),

  // OKR Tick
  getOkrTickStatus: () =>
    apiClient.get('/brain/okr-tick/status'),

  triggerOkrTick: () =>
    apiClient.post('/brain/okr-tick'),

  // Nightly Tick
  getNightlyStatus: () =>
    apiClient.get('/brain/nightly/status'),

  // Execution Status
  getVpsSlots: () =>
    apiClient.get<VpsSlotsResponse>('/brain/vps-slots'),

  getExecutionHistory: (limit: number = 20) =>
    apiClient.get<ExecutionHistoryResponse>('/brain/execution-history', { params: { limit } }),

  // Cecelia Execution Logs
  getCeceliaRuns: (filters?: { status?: string; limit?: number }) =>
    apiClient.get<RunsListResponse>('/cecelia/runs', { params: filters }),

  getCeceliaRunLogs: (runId: string) =>
    apiClient.get<LogsResponse>(`/cecelia/runs/${runId}/logs`),

  // Hardening Status
  getHardeningStatus: () =>
    apiClient.get<HardeningStatusResponse>('/brain/hardening/status'),

  // Alertness Override
  overrideAlertness: (level: number, reason: string) =>
    apiClient.post('/brain/alertness/override', { level, reason }),

  clearAlertnessOverride: () =>
    apiClient.post('/brain/alertness/clear-override'),
};

// Hardening Status Types
export interface HardeningStatusResponse {
  version: string;
  checked_at: string;
  overall_status: 'ok' | 'warn' | 'critical';
  features: {
    transactional_decisions: {
      enabled: boolean;
      recent_10: { committed: number; rolled_back: number };
      last_rollback: { at: string; error: string } | null;
    };
    failure_classification: {
      enabled: boolean;
      last_1h: { systemic: number; task_specific: number; unknown: number };
    };
    event_backlog: {
      enabled: boolean;
      current_10min: number;
      threshold: number;
      peak_24h: number;
    };
    alertness_decay: {
      enabled: boolean;
      current_score: { raw: number; decayed: number };
      level: string;
      recovery_gate: { target: string; remaining_ms: number } | null;
    };
    pending_actions: {
      enabled: boolean;
      pending: number;
      approved_24h: number;
      rejected_24h: number;
      expired_24h: number;
    };
    llm_errors: {
      enabled: boolean;
      last_1h: { api_error: number; bad_output: number; timeout: number };
    };
  };
}

// Execution Status Types
export interface VpsSlot {
  pid: number;
  cpu: string;
  memory: string;
  startTime: string;
  taskId: string | null;
  runId: string | null;
  startedAt: string | null;
  command: string;
  taskTitle: string | null;
  taskPriority: string | null;
  taskType: string | null;
}

export interface VpsSlotsResponse {
  success: boolean;
  total: number;
  used: number;
  available: number;
  slots: VpsSlot[];
}

export interface ExecutionRecord {
  id: string;
  trigger: string;
  summary: string;
  result: any;
  status: string;
  timestamp: string;
}

export interface ExecutionHistoryResponse {
  success: boolean;
  total: number;
  today: number;
  executions: ExecutionRecord[];
}
