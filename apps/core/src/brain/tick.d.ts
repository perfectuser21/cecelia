export function getTickStatus(): Promise<{
  enabled: boolean;
  loop_running: boolean;
  interval_minutes: number;
  loop_interval_ms: number;
  last_tick: string | null;
  next_tick: string | null;
  actions_today: number;
  tick_running: boolean;
  last_dispatch: Record<string, unknown> | null;
  max_concurrent: number;
  dispatch_timeout_minutes: number;
}>;
export function enableTick(): Promise<{ success: boolean; enabled: boolean; loop_running: boolean }>;
export function disableTick(): Promise<{ success: boolean; enabled: boolean; loop_running: boolean }>;
export function executeTick(): Promise<Record<string, unknown>>;
export function runTickSafe(source?: string, tickFn?: () => Promise<unknown>): Promise<Record<string, unknown>>;
export function startTickLoop(): boolean;
export function stopTickLoop(): boolean;
export function initTickLoop(): Promise<void>;
export function isStale(task: { status: string; started_at?: string }): boolean;

export interface DispatchResult {
  dispatched: boolean;
  reason?: string;
  task_id?: string;
  run_id?: string;
  active?: number;
  db_active?: number;
  process_active?: number;
  actions: Array<Record<string, unknown>>;
}

export function dispatchNextTask(goalIds: string[]): Promise<DispatchResult>;
export function selectNextDispatchableTask(goalIds: string[]): Promise<Record<string, unknown> | null>;
export function autoFailTimedOutTasks(inProgressTasks: Array<{ id: string; title: string; status: string; started_at?: string; payload?: Record<string, unknown> }>): Promise<Array<Record<string, unknown>>>;

export const TICK_INTERVAL_MINUTES: number;
export const TICK_LOOP_INTERVAL_MS: number;
export const TICK_TIMEOUT_MS: number;
export const DISPATCH_TIMEOUT_MINUTES: number;
export const DISPATCH_COOLDOWN_MS: number;
export const MAX_CONCURRENT_TASKS: number;
