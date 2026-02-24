const BRAIN_URL = 'http://localhost:5221/api/brain';

export interface WorkerModel {
  provider: string | null;
  name: string | null;
  full_map: Record<string, string | null>;
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
  level: string;
  icon: string;
  description: string;
  workers: Worker[];
}

export interface StaffResponse {
  success: boolean;
  version: string;
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
