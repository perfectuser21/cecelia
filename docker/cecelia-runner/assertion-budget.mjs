// assertion-budget.mjs — 信任断言 npm 安装预算计算（单一事实源，entrypoint 调用）。
//
// r75/r79/r80/r81 四轮实证：旧公式 min(1800, deadline 余量) 在 run 后期重取证
// （recollect/人审后重派）时余量只剩秒级，616 包冷装必被 SIGTERM 超时 →
// evaluator 真实 PASS 被改判 FAIL。保底 600s 让安装完成——宁可 run 略超
// deadline（validation clock 有 fix 轮顺延兜底），不杀全绿 run。
// deadline 无效/未设时回落 configured（原语义不变）。
export function computeBudgetSeconds(deadlineArg, configuredArg, nowMs = Date.now()) {
  const deadline = Date.parse(deadlineArg);
  const configured = Number(configuredArg);
  const fallback = Number.isSafeInteger(configured) && configured > 0 ? configured : 1800;
  const remaining = Number.isFinite(deadline)
    ? Math.floor((deadline - nowMs) / 1000)
    : fallback;
  return Math.max(600, Math.min(1800, remaining));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(String(computeBudgetSeconds(process.argv[2], process.argv[3])));
}
