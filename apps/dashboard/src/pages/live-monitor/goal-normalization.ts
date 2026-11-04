// LiveMonitor API响应的唯一normalize实现；组件与回归共同消费。
export function normalizeLiveGoals(goals: Array<Record<string, any>>) {
  return goals
    .filter((g: any) => ['area_okr', 'global_okr', 'kr', 'area_kr'].includes(g.type))
    .map((g: any) => {
      // 优先API手动百分比，退化到current_value/target_value计算。
      const progressPct = g.progress_pct != null ? Number(g.progress_pct) : null;
      const cv = g.current_value != null ? Number(g.current_value) : null;
      const tv = g.target_value != null ? Number(g.target_value) : null;
      const progress = progressPct != null
        ? progressPct
        : cv != null
        ? (tv != null && tv > 0 ? Math.round(cv / tv * 100) : Math.round(cv))
        : (g.progress ?? null);
      const remapped = g.type === 'area_kr' ? { ...g, type: 'kr' } : g;
      return { ...remapped, progress };
    });
}
