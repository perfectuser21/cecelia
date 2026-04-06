const BRAIN = '/api/brain';

export interface PublishStats {
  success: boolean;
  period_days: number;
  total: number;
  total_success: number;
  total_fail: number;
  by_platform: {
    platform: string;
    success_count: number;
    fail_count: number;
    total_count: number;
    success_rate: number | null;
    fail_reasons: string[];
  }[];
  daily_trend: { day: string; success_count: number; fail_count: number }[];
}

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

export interface SocialPost {
  platform: string;
  title?: string;
  author?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  scraped_at: string;
}

export interface ContentPerformance {
  posts: SocialPost[];
  has_data: boolean;
}

export async function fetchPublishStats(days = 1): Promise<PublishStats> {
  const r = await fetch(`${BRAIN}/publish-results/stats?days=${days}`);
  if (!r.ok) throw new Error(`publish-results/stats: ${r.status}`);
  return r.json();
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

export async function fetchContentPerformance(days = 7): Promise<ContentPerformance> {
  try {
    const r = await fetch(`${BRAIN}/social/trending?days=${days}&limit=10`);
    if (!r.ok) return { posts: [], has_data: false };
    const data = await r.json();
    const posts: SocialPost[] = Array.isArray(data) ? data : [];
    return { posts, has_data: posts.length > 0 };
  } catch {
    return { posts: [], has_data: false };
  }
}
