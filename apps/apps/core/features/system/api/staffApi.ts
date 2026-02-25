const BRAIN_URL = '/api/brain';

export interface WorkerModel {
  provider: string | null;
  name: string | null;
  full_map: Record<string, string | null>;
  credentials_file: string | null;
}

export interface Worker {
  id: string;
  name: string;
  alias: string | null;
  icon: string;
  type: string;
  role: string;
  skill: string | null;
  description: string;
  abilities: Array<{ id: string; name: string; description: string }>;
  gradient: { from: string; to: string } | null;
  model: WorkerModel;
}

export interface Team {
  id: string;
  name: string;
  area: string | null;
  department: string | null;
  level: string;
  icon: string;
  description: string;
  workers: Worker[];
}

export interface AreaConfig {
  name: string;
  description: string;
  icon: string;
}

export interface StaffResponse {
  success: boolean;
  version: string;
  areas: Record<string, AreaConfig>;
  teams: Team[];
  total_workers: number;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  version: string;
  type: 'skill' | 'agent';
  path: string;
}

export interface SkillsRegistryResponse {
  success: boolean;
  total: number;
  skills: SkillItem[];
  agents: SkillItem[];
}

export async function fetchStaff(): Promise<StaffResponse> {
  const res = await fetch(`${BRAIN_URL}/staff`);
  if (!res.ok) throw new Error(`Staff API error: ${res.status}`);
  return res.json();
}

export async function fetchSkillsRegistry(): Promise<SkillsRegistryResponse> {
  const res = await fetch(`${BRAIN_URL}/skills-registry`);
  if (!res.ok) throw new Error(`Skills registry API error: ${res.status}`);
  return res.json();
}

export interface ModelEntry {
  id: string;
  name?: string;
  provider: string;
  tier?: string;
}

export async function fetchModels(): Promise<ModelEntry[]> {
  const res = await fetch(`${BRAIN_URL}/model-profiles/models`);
  if (!res.ok) throw new Error(`Models API error: ${res.status}`);
  const data = await res.json();
  return (data.models || []) as ModelEntry[];
}

export interface WorkerUpdatePayload {
  skill?: string | null;
  model?: { provider: string; name: string } | null;
  credentials_file?: string | null;
}

export async function updateWorker(workerId: string, payload: WorkerUpdatePayload): Promise<void> {
  const res = await fetch(`${BRAIN_URL}/staff/workers/${workerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `Update worker failed: ${res.status}`);
  }
}

export interface CredentialEntry {
  name: string;
  type: 'anthropic_oauth' | 'api_key';
  path: string;
  provider: string;
}

export async function fetchCredentials(): Promise<CredentialEntry[]> {
  try {
    const res = await fetch(`${BRAIN_URL}/credentials`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.credentials || []) as CredentialEntry[];
  } catch {
    return [];
  }
}
