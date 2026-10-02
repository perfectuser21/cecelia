const API_BASE = import.meta.env.VITE_API_URL || '';
const BASE = `${API_BASE}/api/brain/machines/onboarding`;

export interface NodeOnboardingInput {
  name: string;
  address: string;
  ssh_user: string;
  ssh_port: number;
  credential_ref: string;
  host_key_fingerprint: string;
  role: 'observer' | 'worker' | 'service' | 'database';
  region: 'US' | 'HK' | 'CN' | 'other';
}
export interface NodeOnboardingRequest {
  id: string;
  task_id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  stage: string | null;
  error: string | null;
  machine_name: string;
  notice?: string;
  automatic?: boolean;
  capabilities?: { collector: boolean; janitor: boolean; execution: boolean };
  steps: { key: string; label: string; status: 'pending' | 'running' | 'completed' | 'failed'; message?: string }[];
}
async function request<T>(url: string, failure: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, options); }
  catch { throw new Error(`${failure}，请检查网络后重试`); }
  if (!response.ok) throw new Error(`${failure}（HTTP ${response.status}）`);
  try { return await response.json(); }
  catch { throw new Error(`${failure}，服务器返回格式异常`); }
}
export const nodeOnboardingApi = {
  list: (signal?: AbortSignal) => request<{ items: NodeOnboardingRequest[] }>(BASE, '接入记录读取失败', { signal }),
  get: (id: string, signal?: AbortSignal) => request<NodeOnboardingRequest>(`${BASE}/${encodeURIComponent(id)}`, '进度读取失败', { signal }),
  create: (input: NodeOnboardingInput, key: string) => request<NodeOnboardingRequest>(BASE, '接入请求提交失败', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input),
  }),
  retry: (id: string) => request<NodeOnboardingRequest>(`${BASE}/${encodeURIComponent(id)}/retry`, '重试接入失败', { method: 'POST' }),
};
