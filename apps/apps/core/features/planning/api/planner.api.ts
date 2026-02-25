import axios from 'axios';

// Semantic Brain API (Task Intelligence)
const SEMANTIC_BRAIN_URL = import.meta.env.VITE_SEMANTIC_BRAIN_URL || '/semantic-brain';
const semanticClient = axios.create({
  baseURL: SEMANTIC_BRAIN_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Core API (Cecelia + Tasks)
const coreClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// ============ Cecelia API (Real Task Data) ============

export interface CeceliaRun {
  id: string;
  project: string;
  feature_branch: string;
  prd_path: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_checkpoints: number;
  completed_checkpoints: number;
  failed_checkpoints: number;
  current_action?: string;
  current_step?: string;
  step_status?: string;
  pr_url?: string;
  started_at: string;
  updated_at: string;
}

export interface CeceliaOverview {
  total_runs: number;
  running: number;
  completed: number;
  failed: number;
  recent_runs: CeceliaRun[];
}

export async function fetchCeceliaOverview(limit = 20): Promise<CeceliaOverview> {
  const response = await coreClient.get(`/cecelia/overview?limit=${limit}`);
  return response.data;
}

export async function fetchCeceliaRun(runId: string): Promise<CeceliaRun> {
  const response = await coreClient.get(`/cecelia/runs/${runId}`);
  return response.data.run;
}

export interface CreateRunRequest {
  project: string;
  feature_branch: string;
  prd_path: string;
  total_checkpoints: number;
}

export async function createCeceliaRun(request: CreateRunRequest): Promise<{ run_id: string; run: CeceliaRun }> {
  const response = await coreClient.post('/cecelia/runs', request);
  return response.data;
}

// ============ N8N Trigger (Execute Task) ============

export interface TriggerTaskRequest {
  project: string;
  prd_content: string;
  branch?: string;
}

export async function triggerCeceliaTask(request: TriggerTaskRequest): Promise<{ success: boolean; message: string }> {
  try {
    // Trigger via N8N webhook
    const response = await axios.post('/n8n/webhook/cecelia-start', request);
    return { success: true, message: response.data.message || 'Task triggered' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Failed to trigger task' };
  }
}

// ============ Task Intelligence API (Planning) ============

export interface TaskInput {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  status: 'queued' | 'in_progress' | 'completed' | 'blocked';
  dependencies?: string[];
  estimated_time?: string;
  blocked_by?: string[];
  title?: string;
}

export interface TaskStats {
  total: number;
  by_priority: Record<string, number>;
  by_status: Record<string, number>;
}

export interface ExecutionPlanState {
  next_up: string[];
  in_progress: string[];
  waiting: string[];
  blocked: string[];
}

export interface Bottleneck {
  task: string;
  reason: string;
  suggestion: string;
}

export interface PlanResponse {
  current_tasks: TaskStats;
  execution_plan: ExecutionPlanState;
  estimated_completion: string;
  bottlenecks: Bottleneck[];
  risks: any[];
}

export interface PlanSummary {
  planner: string;
  max_concurrent: number;
  capabilities: string[];
}

// Convert Cecelia runs to TaskInput format for planning
export function ceceliaRunsToTasks(runs: CeceliaRun[]): TaskInput[] {
  return runs.map((run, index) => ({
    id: run.id,
    title: `${run.project} - ${run.feature_branch}`,
    priority: run.status === 'running' ? 'P0' : 'P1',
    status: mapCeceliaStatus(run.status),
    dependencies: [],
    estimated_time: '30min',
  }));
}

function mapCeceliaStatus(status: CeceliaRun['status']): TaskInput['status'] {
  switch (status) {
    case 'running': return 'in_progress';
    case 'completed': return 'completed';
    case 'failed': return 'blocked';
    default: return 'queued';
  }
}

export async function fetchPlan(tasks: TaskInput[]): Promise<PlanResponse> {
  if (tasks.length === 0) {
    // Return empty plan if no tasks
    return {
      current_tasks: { total: 0, by_priority: { P0: 0, P1: 0, P2: 0 }, by_status: { queued: 0, in_progress: 0, completed: 0, blocked: 0 } },
      execution_plan: { next_up: [], in_progress: [], waiting: [], blocked: [] },
      estimated_completion: '0min',
      bottlenecks: [],
      risks: [],
    };
  }
  const response = await semanticClient.post('/plan', { tasks });
  return response.data;
}

export async function fetchPlanSummary(): Promise<PlanSummary> {
  const response = await semanticClient.get('/plan/summary');
  return response.data;
}

// ============ Detector API ============

export interface DetectorStatus {
  running: boolean;
  monitors: Record<string, {
    name: string;
    enabled: boolean;
    last_check: string | null;
    events_detected: number;
    processed_ids_count: number;
  }>;
  total_events: number;
  last_check: string | null;
  check_interval_seconds: number;
}

export interface DetectorEvent {
  event_id: string;
  event_type: string;
  severity: string;
  title: string;
  description: string;
  source: string;
  timestamp: string;
  metadata: Record<string, any>;
}

export async function fetchDetectorStatus(): Promise<DetectorStatus> {
  const response = await semanticClient.get('/detector/status');
  return response.data;
}

export async function fetchDetectorEvents(limit = 50): Promise<{ events: DetectorEvent[]; total: number }> {
  const response = await semanticClient.get(`/detector/events?limit=${limit}`);
  return response.data;
}

// ============ Panorama API (VPS Command Center) ============

export interface VPSStats {
  cpu: {
    usage: number;
    cores: number;
    load: number[];
  };
  memory: {
    total_gb: number;
    used_gb: number;
    percent: number;
  };
  disk: {
    total_gb: number;
    used_gb: number;
    percent: number;
  };
  uptime: string;
}

export interface ClaudeSession {
  pid: string;
  cpu: number;
  memory: number;
  runtime: string;
  project: string;
  repository: string;
  cwd: string;
  status: 'active' | 'idle';
}

export interface DockerContainer {
  name: string;
  status: string;
  ports: string;
}

export interface CommandCenterData {
  timestamp: string;
  vps: VPSStats;
  claude: {
    active_sessions: number;
    sessions: ClaudeSession[];
    by_repository: Record<string, ClaudeSession[]>;
  };
  docker: {
    containers: DockerContainer[];
    running: number;
  };
  capacity: {
    max_concurrent: number;
    current_load: number;
    available_slots: number;
  };
}

export async function fetchCommandCenter(): Promise<CommandCenterData> {
  const response = await coreClient.get('/panorama/command-center');
  return response.data.data;
}
