// 推进项进度纯计算：counts → {done,doing,todo,total,pct}。pct 整数四舍五入，total=0 时 pct=0。
export function computeProgress({ done = 0, doing = 0, todo = 0 } = {}) {
  const total = done + doing + todo;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, doing, todo, total, pct };
}
