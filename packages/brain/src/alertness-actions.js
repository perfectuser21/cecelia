/**
 * 派发保护状态的只读兼容接口。
 * 现役 Observer 通过 alertness/index.js 与 alertness/escalation.js 响应异常。
 * 旧 transition/RCA/mitigation 写入口没有生产消费者，已退休。
 */
const mitigationState = {
  p2_paused: false,
  drain_mode_requested: false,
};

export function getMitigationState() {
  return { ...mitigationState };
}

export default { getMitigationState };
