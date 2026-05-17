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

/** 来自 content_analytics 表的自有内容数据（PR #1941 新增） */
export interface ContentAnalyticsItem {
  id: string;
  platform: string;
  content_id: string;
  title?: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  collected_at: string;
}

export interface ContentPerformance {
  posts: SocialPost[];
  analytics: ContentAnalyticsItem[];
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
  // 并行：自有内容效果（analytics/content）+ 平台趋势（social/trending）
  const [analyticsResult, trendingResult] = await Promise.allSettled([
    fetch(`${BRAIN}/analytics/content?days=${days}&limit=10`).then(r =>
      r.ok ? (r.json() as Promise<ContentAnalyticsItem[]>) : Promise.resolve([])
    ),
    fetch(`${BRAIN}/social/trending?days=${days}&limit=10`).then(r =>
      r.ok ? (r.json() as Promise<SocialPost[]>) : Promise.resolve([])
    ),
  ]);

  const analytics: ContentAnalyticsItem[] =
    analyticsResult.status === 'fulfilled' && Array.isArray(analyticsResult.value)
      ? analyticsResult.value
      : [];
  const posts: SocialPost[] =
    trendingResult.status === 'fulfilled' && Array.isArray(trendingResult.value)
      ? trendingResult.value
      : [];

  return { posts, analytics, has_data: analytics.length > 0 || posts.length > 0 };
}
