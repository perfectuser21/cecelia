/**
 * report-sources — /reports 双源合并纯函数
 * sys = /api/brain/reports 响应（{ reports: [...] }）
 * docs = /api/brain/design-docs?type=battle_report 响应（{ success, data: [...] }）
 * 任一入参 null/形状不对时该源当空数组处理，不抛错。
 */

export interface MergedReport {
  id: string;
  type: string;
  title: string | null;
  summary: string | null;
  created_at: string;
  source: 'system' | 'design_docs';
  metadata?: Record<string, unknown>;
}

interface SysReportItem {
  id: string;
  type: string;
  title: string | null;
  summary: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface DesignDocItem {
  id: string;
  title: string | null;
  created_at: string;
  [key: string]: unknown;
}

function extractArray(input: unknown, key: string): unknown[] {
  if (!input || typeof input !== 'object') return [];
  const arr = (input as Record<string, unknown>)[key];
  return Array.isArray(arr) ? arr : [];
}

export function mergeReportSources(sys: unknown, docs: unknown): MergedReport[] {
  const sysItems: MergedReport[] = extractArray(sys, 'reports').map((raw) => {
    const r = raw as SysReportItem;
    return {
      id: r.id,
      type: r.type,
      title: r.title ?? null,
      summary: r.summary ?? null,
      created_at: r.created_at,
      source: 'system' as const,
      metadata: r.metadata,
    };
  });

  const docItems: MergedReport[] = extractArray(docs, 'data').map((raw) => {
    const d = raw as DesignDocItem;
    return {
      id: d.id,
      type: 'battle_report',
      title: d.title ?? null,
      summary: '每日作战日报',
      created_at: d.created_at,
      source: 'design_docs' as const,
    };
  });

  return [...sysItems, ...docItems].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
