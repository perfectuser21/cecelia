export interface IntakeQuestion { id: string; prompt: string; options?: string[] }
export interface IntakeRequest { text: string; source_id: string; answers?: Record<string, string> }
export interface PendingIntake extends IntakeRequest {
  questions?: IntakeQuestion[];
  phase?: 'pending' | 'clarification' | 'created';
  task_id?: string;
}
export interface TaskRecord {
  id: string; title?: string; status?: string; created_at?: string;
  updated_at?: string; completed_at?: string; [key: string]: unknown;
}
export type IntakeResponse =
  | { outcome: 'created'; source_id: string; task_id: string; task: TaskRecord; deduplicated?: boolean }
  | { outcome: 'clarification_required'; source_id: string; task_id: null; questions: IntakeQuestion[] };

const STORAGE_KEY = 'cecelia.task-intake.pending.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id);
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function newSourceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器无法生成安全的交办编号，请换用支持安全随机数的浏览器。');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function loadPending(): { pending: PendingIntake | null; error: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pending: null, error: null };
    const pending = JSON.parse(raw);
    if (!validId(pending.source_id) || typeof pending.text !== 'string' ||
      (pending.answers && Object.values(pending.answers).some(v => typeof v !== 'string')) ||
      (pending.task_id && !validId(pending.task_id)) ||
      (pending.questions && !validQuestions(pending.questions))) throw new Error();
    return { pending, error: null };
  } catch {
    return { pending: null, error: '无法读取原交办的重试凭据。请先查看最近交办，确认后用“新交办”重新开始。' };
  }
}
export function savePending(pending: PendingIntake | null): void {
  try {
    if (pending) localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    throw new Error('无法保存重试凭据，尚未提交。请允许此站点使用浏览器存储后重试。');
  }
}
const errors: Record<string, string> = {
  invalid_intake_request: '交办内容或补充答案不完整，请检查后重试。',
  source_id_conflict: '原交办可能已有回执，请查看最近交办。若要另起一件事，请点击“新交办”。',
  unsupported_execution: '这件事目前无法执行。可以交代调研、代码审查或修改；请用“新交办”说明新的范围。',
  invalid_model_contract: '未收到有效的接单回执，请保留当前交办并重试。',
  model_unavailable: '接单服务当前不可用，请保留当前交办并重试。',
  intake_storage_unavailable: '任务存储当前不可用，请保留当前交办并重试。',
  intake_unavailable: '交办服务当前不可用，请保留当前交办并重试。',
};
function validQuestions(value: unknown): value is IntakeQuestion[] {
  return Array.isArray(value) && value.length > 0 && value.every(q =>
    typeof q?.id === 'string' && q.id.length > 0 && typeof q.prompt === 'string' && q.prompt.length > 0 &&
    (q.options === undefined || Array.isArray(q.options) && q.options.every((o: unknown) => typeof o === 'string')));
}
export async function submitIntake(request: IntakeRequest): Promise<IntakeResponse> {
  let response: Response;
  try {
    response = await fetch('/api/brain/task-intake', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
  } catch {
    throw new Error('未收到交办回执，原交办可能已经接收。请保留当前内容重试，或查看最近交办。');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errors[body?.error] || '交办失败，请保留当前内容重试。');
  if (body?.source_id !== request.source_id) throw new Error(errors.invalid_model_contract);
  if (body.outcome === 'created' && validId(body.task_id) && body.task?.id === body.task_id) return body;
  if (body.outcome === 'clarification_required' && body.task_id === null && validQuestions(body.questions)) return body;
  throw new Error(errors.invalid_model_contract);
}
async function readJson(url: string, signal: AbortSignal, message: string): Promise<unknown> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(message);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(message);
  }
}
export async function readTasks(signal: AbortSignal): Promise<TaskRecord[]> {
  const body = record(await readJson('/api/brain/task-intake?limit=20', signal, '最近交办读取失败，请刷新重试。'));
  if (!Array.isArray(body.tasks) || body.tasks.some((task: TaskRecord) => !validId(task?.id))) throw new Error('最近交办读取失败：回执格式无效。');
  return body.tasks;
}
export async function readTask(id: string, signal: AbortSignal): Promise<TaskRecord> {
  const body = record(await readJson(`/api/brain/tasks/tasks/${encodeURIComponent(id)}`, signal, '任务详情读取失败，请刷新重试。'));
  if (body.id !== id) throw new Error('任务详情读取失败：任务编号不一致。');
  return body as TaskRecord;
}
