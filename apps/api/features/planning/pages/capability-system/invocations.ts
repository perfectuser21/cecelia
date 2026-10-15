export interface InvocationTarget { kind: 'activity' | 'workflow'; id: string; definition_version_id?: string }
export interface InputSchema { type?: string; title?: string; description?: string; enum?: Array<string | number>; default?: unknown; properties?: Record<string, InputSchema>; required?: string[]; items?: InputSchema }
export interface InvocationGap { code: string; message?: string; field?: string }
const gapMessages: Record<string,string> = {
  transport_missing:'缺少可用的执行通道', transport_not_connected:'执行通道尚未接通',
  transport_resource_unavailable:'执行设备离线或资源不足', runtime_admission_unverified:'执行条件尚未核验',
  verified_release_missing:'尚无通过验证并已部署的正式发布版本',
  input_schema_invalid:'请补全或修正业务输入', activity_schema_invalid:'活动输入或产物合同尚未验证',
  implementation_source_unverified:'执行来源尚未核验', implementation_not_connected:'执行实现尚未接通',
  resource_not_connected:'所需资源尚未接通', warehouse_item_missing:'缺少所需资源', skill_not_active:'所需技能当前不可用',
  shared_activity_version_invalid:'引用的活动版本无效', tenant_mismatch:'当前身份无权调用该对象',
  execution_mode_unsupported:'当前执行方式尚不支持直接调用', mutation_unsupported:'当前调用入口不支持此类写入操作',
  execution_evidence_incomplete:'执行证据尚未齐备，正在确认结果', run_ledger_missing:'运行记录尚未齐备，正在确认结果',
};
export const invocationGapMessage = (gap: InvocationGap) => gap.message || gapMessages[gap.code] || '调用条件尚未满足，请查看调用技术信息';
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
    if (!response.ok) throw new InvocationError(result.error?.message || result.message || `请求失败 HTTP ${response.status}`, response.status, result.gaps || result.resolution?.gaps || []);
    return result;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
