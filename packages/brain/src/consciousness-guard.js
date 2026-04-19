// SSOT for Brain consciousness toggle.
// 通过 CONSCIOUSNESS_ENABLED 环境变量控制所有会持续消耗 LLM token 的意识模块。
// 默认启用，设为 'false' 时关闭。BRAIN_QUIET_MODE=true 作为 deprecated 别名继续识别。

export const GUARDED_MODULES = [
  'thalamus', 'rumination', 'rumination-scheduler', 'narrative',
  'diary-scheduler', 'conversation-digest', 'conversation-consolidator',
  'capture-digestion', 'self-report', 'notebook-feeder',
  'proactive-mouth', 'evolution-scanner', 'evolution-synthesizer',
  'desire-system', 'suggestion-cycle', 'self-drive',
  'dept-heartbeat', 'pending-followups',
];

let _deprecationWarned = false;

export function isConsciousnessEnabled() {
  // 新 env 优先
  if (process.env.CONSCIOUSNESS_ENABLED === 'false') return false;
  if (process.env.CONSCIOUSNESS_ENABLED === 'true') return true;
  // Deprecated: 旧 BRAIN_QUIET_MODE=true 作为别名
  if (process.env.BRAIN_QUIET_MODE === 'true') {
    if (!_deprecationWarned) {
      console.warn('[consciousness-guard] BRAIN_QUIET_MODE is deprecated, use CONSCIOUSNESS_ENABLED=false');
      _deprecationWarned = true;
    }
    return false;
  }
  return true;
}

export function logStartupDeclaration() {
  if (!isConsciousnessEnabled()) {
    console.log('[Brain] CONSCIOUSNESS_ENABLED=false — 意识层全部跳过（保留任务派发/调度/监控）');
    console.log('[Brain] 守护模块: ' + GUARDED_MODULES.join('/'));
  }
}

// Test-only: reset internal deprecation flag (for vitest beforeEach)
export function _resetDeprecationWarn() { _deprecationWarned = false; }
