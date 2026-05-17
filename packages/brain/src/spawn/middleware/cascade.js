/**
 * cascade middleware — Brain v2 Layer 3 attempt-loop 内循环第 b 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2 + §5.3。
 *
 * 职责：若 opts.cascade 未设（caller 没显式传），用 getCascadeForTask(opts.task) 填充。
 * 显式 opts.cascade 尊重不覆盖。
 *
 * v2 P2 PR 4（本 PR）：新建 middleware。下游 account-rotation 已在 opts.cascade 上读取，
 * 填充后 selectBestAccount 能用到正确的降级链。
 *
 * @param {object} opts  { task, cascade? }
 * @param {object} ctx   { deps? } — 测试注入 { getCascadeForTask }
 */
export async function resolveCascade(opts, ctx = {}) {
  if (opts.cascade) return;
  if (!opts.task) return;
  try {
    let getCascade;
    if (ctx.deps?.getCascadeForTask) {
      getCascade = ctx.deps.getCascadeForTask;
    } else {
      const mod = await import('../../model-profile.js');
      getCascade = mod.getCascadeForTask;
    }
    const cascade = getCascade(opts.task);
    if (Array.isArray(cascade) && cascade.length > 0) {
      opts.cascade = cascade;
    }
  } catch (err) {
    console.warn(`[cascade] middleware failed (keeping opts.cascade undefined): ${err.message}`);
  }
}
