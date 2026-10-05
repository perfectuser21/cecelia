/**
 * 读回断言求值（树+仓库 v3.0 第 4 刀，路 B）。
 * Step 的 readback.expect（合同口径：== / >= / <= / not_null_all，另支持 != / > / <）对 Step span 里报上来的 observed 求值。
 * 拿不到观测值或没有可比的期望一律「未知」，绝不猜 pass：对不上无从谈起，比误判通过安全。
 * @returns {{verdict:'pass'|'fail'|'unknown', reason?:string}}
 */
const OPS = new Set(['==', '!=', '>=', '<=', '>', '<', 'not_null_all']);

const unwrap = observed => (observed && typeof observed === 'object' && !Array.isArray(observed) && 'value' in observed ? observed.value : observed);

export function evaluateReadback(readback, observed) {
  if (!readback || typeof readback !== 'object' || !readback.type || readback.type === 'none') return { verdict: 'unknown', reason: 'no_readback' };
  const expect = readback.expect;
  if (!expect || !expect.op) return { verdict: 'unknown', reason: 'no_expect' };
  if (observed === undefined) return { verdict: 'unknown', reason: 'no_observation' };
  if (!OPS.has(expect.op)) return { verdict: 'unknown', reason: 'unsupported_op' };

  if (expect.op === 'not_null_all') {
    const items = Array.isArray(observed) ? observed : observed && typeof observed === 'object' ? Object.values(observed) : [observed];
    const ok = items.every(v => v !== null && v !== undefined);
    return ok ? { verdict: 'pass' } : { verdict: 'fail', reason: '存在空值' };
  }

  const value = unwrap(observed);
  const left = Number(value), right = Number(expect.value);
  if (expect.op === '==' || expect.op === '!=') {
    const equal = Number.isFinite(left) && Number.isFinite(right) ? left === right : String(value) === String(expect.value);
    const pass = expect.op === '==' ? equal : !equal;
    return pass ? { verdict: 'pass' } : { verdict: 'fail', reason: `观测 ${JSON.stringify(value)} 不满足 ${expect.op} ${JSON.stringify(expect.value)}` };
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) return { verdict: 'unknown', reason: 'not_numeric' };
  const pass = expect.op === '>=' ? left >= right : expect.op === '<=' ? left <= right : expect.op === '>' ? left > right : left < right;
  return pass ? { verdict: 'pass' } : { verdict: 'fail', reason: `观测 ${left} 不满足 ${expect.op} ${right}` };
}
