export type Category = 'query' | 'input' | 'change' | 'output';
export type Status = 'verified' | 'readChecked' | 'broken' | 'pending';

export const categories: { key: Category; label: string; description: string; responsibility: string }[] = [
  { key: 'query', label: '查询', description: '查看已有的数据、状态和记录。', responsibility: 'Cecelia 看实时运行；Notion 看日常汇总。' },
  { key: 'input', label: '输入', description: '提交新任务、素材、事实或内容。', responsibility: '日常交办和填表主要在 Notion。' },
  { key: 'change', label: '变更', description: '调整现有配置、状态或运行控制。', responsibility: 'Cecelia 管配置；修改后需要验证生效。' },
  { key: 'output', label: '输出', description: '形成处理结果、报告、回执或导出产物。', responsibility: 'Cecelia 提供操作证据；日常结果回 Notion。' },
];

export const statusLabels: Record<Status, string> = {
  verified: '已验收', readChecked: '读取抽查通过', broken: '审计发现断点', pending: '待验证',
};

export interface SourceRow {
  审计编号: string; 功能: string; 功能分类: string | null; 当前核查: string;
  页面名称: string; 网站入口: string | null; 请求方式: string; 后台接口: string;
  处理效果: string; 当前证据: string; 整理建议: string; 本人验收: string; url: string;
}

export interface Verification {
  operationId: string; date: string; evidence: string; kind: Category;
}

export interface Operation {
  id: string; name: string; category: Category; combined: boolean; status: Status;
  page: string; path: string | null; inNavigation: boolean; method: string; api: string;
  effect: string; auditEvidence: string; originalCategory: string; originalStatus: string;
  disposition: string; humanAcceptance: string; notionUrl: string; verification?: Verification;
}

// 旧清单的 EI 合并了输入与变更；这里按主要作用细分，保留原始分类用于复核。
const inputIds = new Set([
  'ConsciousnessChat:04', 'ConsciousnessChat:05', 'ContentClipsPage:02', 'ContentFactory:03',
  'DailyDiary:02', 'DecisionRegistry:02', 'DecisionRegistry:04', 'DesignVault:02', 'DesignVault:04',
  'DevLog:03', 'DocChatPage:04', 'ProfileFacts:02', 'ProfileFacts:03', 'ProjectDetail:01',
  'StrategistLinePage:01', 'TaskDesk:01', 'Tasks:01', 'TodayTabbed:01',
  'WarRoomGoldenPathPage:01', 'WarRoomLineCommandPage:01', 'Whiteboard:01', 'WorkbenchInbox:01',
]);
const combinedIds = new Set(['ProfileFacts:02', 'TaskDesk:01', 'ProjectPanorama:02', 'ConsciousnessChat:05']);

function primaryCategory(row: SourceRow): Category {
  if (row.功能分类 === '查询 EQ') return 'query';
  if (row.功能分类 === '输出 EO') return 'output';
  return inputIds.has(row.审计编号) ? 'input' : 'change';
}

function sourceStatus(row: SourceRow): Status {
  if (row.当前核查 === '发现明确断点') return 'broken';
  if (row.当前核查 === '读取抽查通过') return 'readChecked';
  return 'pending';
}

function internalPath(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'perfect21' || parsed.port !== '5211') return null;
    return parsed.pathname + parsed.search;
  } catch { return null; }
}

export function buildInventory(rows: SourceRow[], verifications: Verification[], navigation: Set<string>): Operation[] {
  const receipts = new Map(verifications.map(v => [v.operationId, v]));
  return rows.filter(row => row.功能分类 != null).map(row => {
    const verification = receipts.get(row.审计编号);
    const path = internalPath(row.网站入口);
    return {
      id: row.审计编号, name: row.功能, category: primaryCategory(row), combined: combinedIds.has(row.审计编号),
      status: verification ? 'verified' : sourceStatus(row), page: row.页面名称,
      path, inNavigation: !!path && navigation.has(path.split('?')[0]), method: row.请求方式,
      api: row.后台接口, effect: row.处理效果, auditEvidence: row.当前证据,
      originalCategory: row.功能分类!, originalStatus: row.当前核查, disposition: row.整理建议,
      humanAcceptance: row.本人验收, notionUrl: row.url, verification,
    };
  });
}

export function summarize(items: Operation[]) {
  const summary = { total: items.length, verified: 0, readChecked: 0, broken: 0, pending: 0,
    categories: { query: 0, input: 0, change: 0, output: 0 } };
  for (const item of items) { summary[item.status]++; summary.categories[item.category]++; }
  return summary;
}

export interface Filters {
  category: Category | 'all'; status: Status | 'all'; navigationOnly: boolean; search: string;
}

export function filterOperations(items: Operation[], filters: Filters) {
  const search = filters.search.trim().toLocaleLowerCase();
  return items.filter(item =>
    (filters.category === 'all' || item.category === filters.category)
    && (filters.status === 'all' || item.status === filters.status)
    && (!filters.navigationOnly || item.inNavigation)
    && (!search || [item.name, item.page, item.api, item.id, item.disposition]
      .join(' ').toLocaleLowerCase().includes(search)));
}
