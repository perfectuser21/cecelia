const SKILL_EVAL_BASE = '/api/skill-eval';
const EVAL_PROXY_TOKEN = import.meta.env.VITE_EVAL_PROXY_TOKEN || '';

function evalHeaders(): HeadersInit {
  const h: HeadersInit = {};
  if (EVAL_PROXY_TOKEN) {
    (h as Record<string, string>)['X-Eval-Proxy-Token'] = EVAL_PROXY_TOKEN;
  }
  return h;
}

export interface SkillEvalUploadResult {
  task_id: string;
  status: 'pending' | 'running';
  message: string;
  queue_position?: number;
}

export interface SkillEvalStatus {
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  queue_position: number | null;
  report_url: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function uploadSkillEval(
  file: File,
  skillName: string,
  submitter: string,
): Promise<SkillEvalUploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('skill_name', skillName);
  form.append('submitter', submitter);
  form.append('source_platform', 'zenithjoy_dashboard');

  const res = await fetch(`${SKILL_EVAL_BASE}/upload`, {
    method: 'POST',
    headers: evalHeaders(),
    body: form,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `上传失败 (${res.status})`);
  }
  return data;
}

export async function getSkillEvalStatus(taskId: string): Promise<SkillEvalStatus> {
  const res = await fetch(`${SKILL_EVAL_BASE}/status/${taskId}`, {
    headers: evalHeaders(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `查询失败 (${res.status})`);
  }
  return data;
}

export function getSkillEvalReportUrl(taskId: string): string {
  return `${SKILL_EVAL_BASE}/report/${taskId}`;
}
