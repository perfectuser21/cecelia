export interface AdvancementItem {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  priority?: string;
  pr_url?: string | null;
}
export interface GroupedAdvancements {
  done: AdvancementItem[];
  doing: AdvancementItem[];
  todo: AdvancementItem[];
  total: number;
  pct: number;
}
// 推进项按状态分栏 + 算完成度百分比（done/total 四舍五入整数）。
export function groupByStatus(items: AdvancementItem[]): GroupedAdvancements {
  const done = items.filter(i => i.status === 'done');
  const doing = items.filter(i => i.status === 'doing');
  const todo = items.filter(i => i.status === 'todo');
  const total = items.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;
  return { done, doing, todo, total, pct };
}
