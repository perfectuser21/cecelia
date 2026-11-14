const BRAIN = '/api/brain';

export interface KrItem {
  id: string;
  title: string;
  current_value: string;
  target_value: string;
  unit: string;
  status: string;
  progress_pct: number;
}

export interface OkrData {
  success: boolean;
  objectives: {
    id: string;
    title: string;
    status: string;
    progress_pct: number;
    key_results: KrItem[];
  }[];
}

export interface ClusterServer {
  id: string;
  name: string;
  location: string;
  status: string;
  resources: {
    cpu_pct: number;
    mem_used_pct: number;
    mem_total_gb: number;
    mem_free_gb: number;
  };
  slots: {
    max: number;
    dynamic_max: number;
    used: number;
    available: number;
  };
}

export interface ClusterStatus {
  success: boolean;
  cluster: {
    total_slots: number;
    total_used: number;
    total_available: number;
    servers: ClusterServer[];
  };
}

export async function fetchOkrCurrent(): Promise<OkrData> {
  const r = await fetch(`${BRAIN}/okr/current`);
  if (!r.ok) throw new Error(`okr/current: ${r.status}`);
  return r.json();
}

export async function fetchClusterStatus(): Promise<ClusterStatus> {
  const r = await fetch(`${BRAIN}/cluster/status`);
  if (!r.ok) throw new Error(`cluster/status: ${r.status}`);
  return r.json();
}
