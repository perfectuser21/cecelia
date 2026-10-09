// locators.mjs —— registry 里「role → 屏幕坐标」的合并规则
//
// 2026-09-06 事故：蒸馏器用 `{ ...existing, ...incoming }` 无条件覆盖，
// 把已 promote 的 search_account 依赖的 search_entry 从 (946,75) 改成 (537,77)，
// 当场把一条正在上岗的技能弄坏。
//
// 教训：registry 是**已上岗技能的共享依赖**，不是本次蒸馏的私有产物。
// 一个 role 的坐标可能正被别的序列用着，新学到的不一定更对——
// 可能只是这次探索走了另一条路径、点到了另一个长得像的按钮。
// 所以默认「只增不改」，冲突只报不动，要覆盖必须显式声明。

export function mergeLocators(existing = {}, incoming = {}, { overwrite = false } = {}) {
  const merged = { ...existing };
  const warnings = [];

  for (const [role, loc] of Object.entries(incoming)) {
    const prev = existing[role];
    if (prev && !overwrite) {
      if (prev.x !== loc.x || prev.y !== loc.y) {
        warnings.push(
          `role「${role}」已有坐标 (${prev.x},${prev.y})，本次学到 (${loc.x},${loc.y})`
          + `——保留已有，需覆盖请显式加 --overwrite`,
        );
      }
      continue;
    }
    merged[role] = loc;
  }

  return { merged, warnings };
}
