/**
 * 契约 Step → Brain steps 行（树+仓库 v3.0 第 4 刀，路 A）。
 * 合同里一个 Step：key/name/order/reads/writes/check/implementation/uses_llm/dod，读回写在 dod.readback、模式写在 dod.mode。
 * 此前同步只认 step.readback，获客线 44 步的 readback 在 Brain 里全是 {}；这里一处定义映射，并给「不写读回不许过」一个硬闸。
 * 不编造：on_fail 只认合同显式声明的 retry:N | abort，没写就是 null。
 */
const ON_FAIL = /^(retry:[0-9]+|abort)$/;

/** 合同 Step 的读回：新形状 dod.readback 优先，旧形状 step.readback 兼容；都没有返回 null。 */
function readbackOf(step) {
  return step.dod?.readback ?? step.readback ?? null;
}

/**
 * @param {object} activity  展开后的合同 Activity（key / from / steps[]）
 * @param {string} canonical `<能力>.<活动>`，规范 Step key 的前缀
 * @param {{id:string,key:string}[]} existing 该 Activity 已有的 steps 行（沿用旧 key，不另造一行）
 * @returns {object[]} syncSteps 吃的 steps：key/activity/order/mode/readback + name/action/inputs/outputs/on_fail
 */
export function declareStepsFromContract(activity, canonical, existing = []) {
  return (activity.steps || []).map((step, index) => {
    if (typeof step.key !== 'string' || !step.key) throw new Error(`步骤缺少稳定key: ${canonical}`);
    const candidates = existing.filter(s => s.key === step.key || s.key === `${canonical}.${step.key}`);
    if (candidates.length > 1) throw new Error(`步骤规范身份不唯一: ${canonical}.${step.key}`);
    if (step.on_fail != null && !ON_FAIL.test(step.on_fail)) throw new Error(`步骤 on_fail 只许 retry:N 或 abort: ${canonical}.${step.key}=${step.on_fail}`);
    return {
      key: candidates[0]?.key || `${canonical}.${step.key}`,
      activity: activity.key,
      order: step.order || index + 1,
      mode: step.dod?.mode ?? step.mode ?? 'checkpoint',
      readback: readbackOf(step) ?? {},
      name: step.name ?? null,
      action: step.action ?? step.implementation?.ref ?? null,
      inputs: step.reads ?? null,
      outputs: step.writes ?? null,
      on_fail: step.on_fail ?? null,
    };
  });
}

/** 一个读回算数：有 type，且 type=none 时必须写原因（合同 schema 同口径：确实读不回要说明）。 */
function hasReadback(step) {
  const rb = readbackOf(step);
  if (!rb || typeof rb !== 'object' || !rb.type) return false;
  if (rb.type === 'none') return typeof step.dod?.reason === 'string' && step.dod.reason.length >= 10;
  return true;
}

/** 不写读回不许过：一次列出全部缺口再抛。没有 steps 的活动不归此闸管。 */
export function assertStepsHaveReadback(activities) {
  const missing = [];
  for (const a of activities) {
    for (const step of a.steps || []) {
      if (!hasReadback(step)) missing.push(`${a.from}.${a.key}.${step.key}`);
    }
  }
  if (missing.length) throw new Error(`step_readback_missing: ${missing.length} 个 Step 没有读回（dod.readback，type=none 需写原因）: ${missing.join(', ')}`);
}
