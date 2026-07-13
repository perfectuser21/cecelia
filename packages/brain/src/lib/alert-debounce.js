/**
 * alert-debounce — 通用告警去抖：连续 N 次才放行 + 放行后冷却期静默（opt-in）
 *
 * 与现有三层限流的关系（串联语义，本层最先）：
 *   debounce（连续N+冷却，opt-in） → alerting P0 5min/eventType 限流 → notifier 60s/eventKey 限流
 * 本层只决定"这次事件够不够格成为一条告警"；后两层是发送频控。
 *
 * ⚠️ P0 事件禁止套 debounce（首击即响）——见 alerting.js raise() 注释。
 * 纯内存态：Brain 重启（蓝绿部署）计数清零，接受此限制（P2 卫生包，不落 DB）。
 */

const _states = new Map(); // eventKey → { count, lastAt, cooldownUntil }
const _MAX_ENTRIES = 1000;
// 计数条目过期：两次事件间隔超过此值视为"不连续"，计数重置
const STALE_MS = 30 * 60 * 1000;

function _gc(now) {
  for (const [key, s] of _states) {
    if (now - s.lastAt >= STALE_MS && (s.cooldownUntil || 0) <= now) _states.delete(key);
  }
}

/**
 * @param {string} eventKey
 * @param {{n: number, cooldownMs: number}} opts - n=连续次数阈值；cooldownMs=放行后静默期
 * @returns {boolean} true=本次应告警
 */
function shouldFire(eventKey, { n, cooldownMs }) {
  const now = Date.now();
  if (_states.size >= _MAX_ENTRIES) _gc(now);
  if (_states.size >= _MAX_ENTRIES) {
    // 兜底：仍超限则删最旧（防 eventKey 基数失控撑爆内存）
    // 注意：极端情况（条目数超上限）可能误删活跃条目，导致该 key 计数重来，接受此权衡
    const oldest = [..._states.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
    if (oldest) _states.delete(oldest[0]);
  }

  const s = _states.get(eventKey) || { count: 0, lastAt: 0, cooldownUntil: 0 };

  if (now < s.cooldownUntil) {
    s.lastAt = now;
    _states.set(eventKey, s);
    return false; // 冷却期内静默
  }
  // 冷却刚结束或间隔过久 → 重新计数
  if (s.cooldownUntil && now >= s.cooldownUntil) s.count = 0;
  if (s.lastAt && now - s.lastAt >= STALE_MS) s.count = 0;
  s.cooldownUntil = 0;

  s.count += 1;
  s.lastAt = now;

  if (s.count >= n) {
    s.count = 0;
    s.cooldownUntil = now + cooldownMs;
    _states.set(eventKey, s);
    return true;
  }
  _states.set(eventKey, s);
  return false;
}

/** 成功/恢复路径调用：清零计数，防"累计 N 次"语义退化 */
function resetDebounce(eventKey) {
  _states.delete(eventKey);
}

/** 测试/状态查询用 */
function _debounceStatus() {
  return { entries: _states.size };
}

export { shouldFire, resetDebounce, _debounceStatus };
