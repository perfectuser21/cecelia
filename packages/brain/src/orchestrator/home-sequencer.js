/**
 * home-sequencer — Brain 内 coding harness 序列器核心（第 80 批）
 *
 * 三代合流架构（Alex 2026-09-05 拍板，coding 线脱离 n8n/OpenClaw 回家）：
 *   顺序 = 本模块（死代码，确定性）
 *   判断 = 常驻监工 claude -p --resume（判断力永不写进死代码——Kernel derive.js 1640 行的血训）
 *   状态 = 台账；手 = fleet 多 provider 容器（现役 attempt-run 机器，不动）
 *
 * 本模块只含「机械问题」：格子表、档位裁剪、裁定词路由、收口摘要蒸馏、监工输出解析。
 * 「该 accepted 还是 retry」永远由监工裁；本模块只回答「监工说 X 之后棋子挪到哪」。
 *
 * 路由判则全部来自实战案卷：r54（evaluate FAIL 回 generator）、#51/#52（seal 被拦
 * 是上游合同病）、c8（publish 确定性 409 终局）、r54 打转熔断（attempt≥4）。
 */

import { validateStageEvidence } from './handoff-schemas.js';

/** 完整格序：init + 九格 + finalize（画布验证过的骨架原样继承） */
export const STAGE_ORDER = Object.freeze([
  '__run_init', 'plan', 'contract', 'seal', 'generate',
  'evaluate', 'judge', 'publish', 'merge', 'cleanup', '__run_finalize',
]);

/**
 * 四档裁剪表（决策 29ae54ae：coding 四形式定档，没有第五种）。
 * 档位只决定跳哪些格；收口双层与裁定纪律四档共用。
 *   ① new_capability：全链 + GAN 对抗 + 人审
 *   ② capability_change：免对抗直出合同（contract 单轮）+ 人审
 *   ③ bugfix：跳 plan/GAN，failing test 锚定直出合同，免人审（judge 从严）
 *   ④ parameter_only：最轻，evaluator 保留（决策原文），免人审
 */
export const GEAR_STAGE_TABLE = Object.freeze({
  new_capability: STAGE_ORDER,
  capability_change: STAGE_ORDER,
  bugfix: Object.freeze([
    '__run_init', 'contract', 'seal', 'generate',
    'evaluate', 'judge', 'publish', 'cleanup', '__run_finalize',
  ]),
  parameter_only: Object.freeze([
    '__run_init', 'generate', 'evaluate', 'publish', 'cleanup', '__run_finalize',
  ]),
});

export function stagesForGear(gear) {
  const stages = GEAR_STAGE_TABLE[gear];
  if (!stages) throw new Error(`unknown_gear:${gear}`);
  return stages;
}

export const VERDICTS = Object.freeze(['accepted', 'retry', 'blocked', 'stopped']);

/** generate/generator-fix 打转熔断上限（画布判则 r54 平移：attempt≥4 = blocked） */
const MAX_STAGE_ATTEMPTS = 4;

/**
 * 裁定词 → 下一步棋。纯函数，唯一正确答案。
 * @param {string} stage 当前格
 * @param {string} verdict 监工裁定词（封闭词表）
 * @param {{gear: string, attempt: number}} ctx
 * @returns {{kind: 'advance'|'retry'|'reroute'|'finalize', target?: string, attempt?: number, status?: string, reason?: string}}
 */
export function routeVerdict(stage, verdict, ctx) {
  if (!VERDICTS.includes(verdict)) throw new Error(`invalid_verdict:${verdict}`);
  const stages = stagesForGear(ctx.gear);

  if (verdict === 'accepted') {
    const i = stages.indexOf(stage);
    const next = stages[i + 1];
    return next ? { kind: 'advance', target: next } : { kind: 'finalize', status: 'completed' };
  }

  if (verdict === 'stopped') return { kind: 'finalize', status: 'stopped' };

  if (verdict === 'retry') {
    // r54 判则：evaluate 完成但业务裁决 FAIL —— 缺口在候选身上，改道 generator-fix，
    // 绝不让 judge 复核一个已判 FAIL 的候选（#54 金丝雀的纠正）。
    if (stage === 'evaluate') {
      return { kind: 'reroute', target: 'generate', reason: 'evaluate_fail_routes_to_generator_fix' };
    }
    if ((ctx.attempt ?? 1) >= MAX_STAGE_ATTEMPTS) {
      return { kind: 'finalize', status: 'blocked', reason: `stage_attempt_cap:${stage}` };
    }
    return { kind: 'retry', target: stage, attempt: (ctx.attempt ?? 1) + 1 };
  }

  // blocked
  if (stage === 'seal') {
    // #51/#52 判则：seal 被引用完备性闸拦下 = 上游合同产物本身有病，重试 seal 无意义。
    return { kind: 'reroute', target: 'contract', reason: 'seal_blocked_means_contract_defect' };
  }
  // c8 判则（publish 确定性 409）与其余 blocked 一致：终局归档升人。
  return { kind: 'finalize', status: 'blocked', reason: `stage_blocked:${stage}` };
}

/** 收口摘要蒸馏字节上限（喂食纪律：监工只吃熟料，压缩病源头绝育） */
const DIGEST_MAX_BYTES = 1200;

/**
 * 把工人信封蒸馏成喂给监工的收口摘要。
 * 交接件坐标（sha/branch 等）必须原样保留——监工要拿它跨格对质；长文摘要截断让路。
 */
export function buildCheckpointDigest(envelope) {
  const head = `收口 — 阶段:${envelope.stage_id} 第${envelope.stage_attempt}次尝试 工人状态:${envelope.status}`;
  const coords = (envelope.evidence ?? [])
    .filter((e) => e && typeof e === 'object' && e.type)
    .map((e) => {
      const { type, ...rest } = e;
      return `${type}: ${Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    })
    .join('\n');
  const fixed = `${head}\n${coords ? `交接件:\n${coords}\n` : ''}`;
  const budget = DIGEST_MAX_BYTES - Buffer.byteLength(fixed, 'utf8') - 24;
  let summary = String(envelope.summary ?? '');
  while (Buffer.byteLength(summary, 'utf8') > Math.max(budget, 0)) {
    summary = summary.slice(0, Math.floor(summary.length * 0.9));
  }
  return `${fixed}摘要:${summary}`;
}

/**
 * 双层收口·机械层（先于监工运行）：79 批交接件 schema 校验。
 * 不合格 → 就地打回并点名字段，不劳烦监工；合格才蒸馏摘要唤醒监工裁质量。
 * @returns {{ok: boolean, issues: string[]}}
 */
export function mechanicalCheckpoint(stage, evidence) {
  return validateStageEvidence(stage, evidence);
}

/**
 * 解析监工回复：封闭词表机器行 `VERDICT: <word>`。
 * 多个 VERDICT 取最后一个（监工自我修正惯例）；词表外/缺机器行 → verdict=null，
 * 由调用方走重问/升人路径——绝不猜。
 */
export function parseCommanderReply(text) {
  const s = String(text ?? '');
  const matches = [...s.matchAll(/VERDICT:\s*([a-zA-Z_]+)/g)];
  const last = matches.at(-1);
  const word = last?.[1]?.toLowerCase() ?? null;
  const verdict = VERDICTS.includes(word) ? word : null;
  const reasoning = s.slice(0, matches.length ? s.indexOf(matches[0][0]) : s.length).trim();
  return { verdict, reasoning };
}
