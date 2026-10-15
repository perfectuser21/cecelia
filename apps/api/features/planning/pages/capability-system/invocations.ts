export interface InvocationTarget { kind: 'activity' | 'workflow'; id: string; definition_version_id?: string }
export interface InputSchema { type?: string; title?: string; description?: string; enum?: Array<string | number>; default?: unknown; properties?: Record<string, InputSchema>; required?: string[]; items?: InputSchema }
export interface InvocationGap { code: string; message?: string; field?: string }
export interface InvocationRequest { target: InvocationTarget; input: Record<string, unknown>; mode: 'released' | 'candidate'; authoring_task_id?: string; compose_sha256?: string }
export interface Resolution { target: InvocationTarget; readiness: 'ready' | 'blocked' | 'unverified'; gaps: InvocationGap[]; input_schema?: InputSchema; output_schema?: InputSchema }
export interface InvocationResult { task_id: string; status: string; target: InvocationTarget; outputs?: unknown; evidence?: unknown; gaps?: InvocationGap[]; run_id?: string; request_key?: string }
export const INVOCATION_POLL_MS = 5000;
export const terminalInvocation = (status: string) => ['completed', 'failed', 'cancelled', 'canceled', 'rejected'].includes(status);
export const invocationStatus = (status: string) => ({ accepted: '已受理', queued: '排队中', in_progress: '运行中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消', rejected: '已拒绝', result_pending: '结果确认中', unknown: '结果确认中' }[status] || `结果确认中（${status}）`);
export class InvocationError extends Error { constructor(message: string, public status: number, public gaps: InvocationGap[] = []) { super(message); } }
export async function invocationJson<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  try {
    const response = await fetch(`/api/brain/invocations${path}`, { signal: controller.signal, credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new InvocationError(result.error?.message || result.message || `请求失败 HTTP ${response.status}`, response.status, result.gaps || []);
    return result;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
