export interface BrainConfig {
  url: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  enableWebSocket?: boolean;
  apiKey?: string;
}

export interface BrainStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  tickLoop: {
    status: 'running' | 'stopped';
    lastTick: string;
    nextTick: string;
    tickCount: number;
  };
  resources: {
    cpu: number;
    memory: {
      used: number;
      total: number;
    };
    tasks: {
      queued: number;
      inProgress: number;
      completed: number;
      failed: number;
    };
  };
  alertness: {
    level: number;
    state: string;
    triggers: string[];
  };
}

export interface Task {
  id?: number;
  title: string;
  description?: string;
  status: 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'quarantined';
  priority: 'P0' | 'P1' | 'P2';
  skill?: string;
  goal_id?: number;
  pr_plan_id?: number;
  assigned_agent?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  result?: any;
  metadata?: Record<string, any>;
}

export interface Decision {
  decision: string;
  reasoning: string;
  confidence: number;
  alternatives?: Array<{
    decision: string;
    reasoning: string;
    confidence: number;
  }>;
  metadata?: Record<string, any>;
}

export interface Project {
  id?: number;
  name: string;
  type: 'service' | 'library' | 'cli' | 'webapp';
  path: string;
  repo_url?: string;
  description?: string;
  status?: 'active' | 'inactive' | 'archived';
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

export interface TraceEvent {
  sessionId: string;
  timestamp: string;
  type: 'start' | 'end' | 'error' | 'info' | 'warning' | 'metric';
  component: string;
  action: string;
  data?: any;
  duration?: number;
  error?: string;
}

export interface AnalysisResult {
  type: 'quality' | 'security' | 'performance';
  score: number;
  issues: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    type: string;
    message: string;
    file?: string;
    line?: number;
    column?: number;
    suggestion?: string;
  }>;
  suggestions: string[];
  metadata?: Record<string, any>;
}

export interface SuggestionResult {
  suggestions: Array<{
    type: 'refactor' | 'optimization' | 'bug-fix' | 'improvement';
    title: string;
    description: string;
    confidence: number;
    code?: string;
    impact?: 'high' | 'medium' | 'low';
  }>;
  reasoning?: string;
  metadata?: Record<string, any>;
}

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  exitCode?: number;
}

export interface MetricsData {
  timestamp: string;
  type: string;
  values: Record<string, number>;
  tags?: Record<string, string>;
}

export interface Goal {
  id?: number;
  project_id?: number;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'P0' | 'P1' | 'P2';
  progress: number;
  due_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PRPlan {
  id?: number;
  project_id: number;
  title: string;
  description?: string;
  dod?: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimated_hours?: number;
  status?: 'pending' | 'in_progress' | 'completed';
  pr_number?: number;
  branch_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RunEvent {
  id?: number;
  run_id: number;
  timestamp: string;
  type: 'start' | 'progress' | 'complete' | 'error' | 'warning' | 'info';
  message: string;
  data?: any;
  source?: string;
}