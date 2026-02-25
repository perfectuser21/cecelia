/**
 * Types for Execution Logs functionality
 */

export interface CeceliaRun {
  id: string;
  task_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  agent?: string;
  log_file?: string;
}

export interface LogLine {
  lineNumber: number;
  content: string;
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'UNKNOWN';
  timestamp?: string;
}

export interface LogFilters {
  runId?: string;
  status?: CeceliaRun['status'];
  startDate?: string;
  endDate?: string;
  searchText?: string;
}

export interface LogsResponse {
  success: boolean;
  run: CeceliaRun;
  logs: string[];
  totalLines: number;
}

export interface RunsListResponse {
  success: boolean;
  runs: CeceliaRun[];
  total: number;
}
