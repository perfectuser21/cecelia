/* eslint-disable no-undef */ // Node ESM 全局(process/fetch/console/AbortSignal)
// Contract 提议器 — 方向闸的命门质量全靠这个模块。
// proposeContract 接真 LLM(OpenRouter DeepSeek):读 task 产出真实「打算怎么做」
//   (approach/files/tests/risk),且能吃 steer(主理人一句话方向)重出对齐版本。
// 纪律:
//   - demo-cache 分支保持确定性(--demo 稳过,不碰网络)。
//   - LLM 失败/脏输出 → 降级回模板骨架(_fallback=true),绝不崩。
//   - renderContract 保持不变。
// 凭据:复用 OpenRouter 约定(process.env.OPENROUTER_API_KEY,见 agent-ops/openrouter.ts)。
//   contract.mjs 被 node 原生运行,故内联 fetch 调用(不 import .ts),与 openrouter.ts 同协议。

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.PROPOSER_MODEL || 'deepseek/deepseek-chat';

// ── 模板骨架:LLM 不可用 / 失败时的降级方案(确定性,不崩)──────────────
function templateContract(task, steer, fallback) {
  const dir = steer ? `据主理人方向[${steer}],` : '';
  return {
    approach: `[骨架占位] ${dir}针对「${task.title}」的实现方案待 LLM Proposer 产出`,
    files: ['<待定>'],
    tests: ['<待定>'],
    risk: '<待定>',
    ...(fallback ? { _fallback: true } : {}),
  };
}

// ── 拼 prompt:喂 task + steer,要求严格 JSON ────────────────────────────
function buildMessages(task, steer) {
  const system = [
    '你是资深工程指挥的「方案提议器」。给定一个开发任务,产出动手前的 Contract:',
    '- approach: 一句话「打算怎么做」(技术路线,具体到模块/层)',
    '- files: 预计要动的文件路径数组(尽量真实,基于常见仓库布局)',
    '- tests: 怎么验的测试点数组(happy + 边界/错误)',
    '- risk: 已知风险/取舍一句话',
    '严格只输出一个 JSON 对象,字段为 approach(字符串) / files(字符串数组) / tests(字符串数组) / risk(字符串)。',
    '不要输出任何与该 JSON 无关的解释。',
  ].join('\n');

  const userLines = [
    `任务标题: ${task.title || '(无)'}`,
    `任务描述: ${task.description || '(无)'}`,
  ];
  if (steer) {
    userLines.push(
      '',
      `【主理人方向(最高优先级,据此对齐重出)】: ${steer}`,
      '必须让你的 approach/files/tests 与这个方向一致,不得违背。',
    );
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: userLines.join('\n') },
  ];
}

// ── 容错解析:从 LLM 文本里抽出第一个 JSON 对象并校验四字段 ──────────────
function parseContract(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const raw = text.trim();
  // 抽取首个 {...} 块(容忍 markdown ```json 包裹 / 前后闲聊)
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const okStr = (v) => typeof v === 'string' && v.length > 0;
  const okArr = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');
  if (!okStr(obj.approach) || !okArr(obj.files) || !okArr(obj.tests) || !okStr(obj.risk)) {
    return null;
  }
  return { approach: obj.approach, files: obj.files, tests: obj.tests, risk: obj.risk };
}

// ── 调 OpenRouter(内联,与 openrouter.ts 同协议);抛错由调用方降级 ────────
async function callLLM(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/cecelia-monorepo',
      'X-Title': 'ZenithJoy Autopilot Conductor',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 800,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`OpenRouter ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

export async function proposeContract(task, steer) {
  // ── demo-cache:确定性分支,保持 --demo 稳过(不碰网络)──────────────
  if (task.id === 'demo-cache') {
    if (!steer) {
      return {
        approach: '在 Dashboard 前端用 localStorage 缓存 daily-report,过期 5 分钟',
        files: ['apps/dashboard/src/pages/DailyReport.tsx'],
        tests: ['前端单测: localStorage 命中/过期'],
        risk: '前端各端不共享、刷新即丢、多用户不一致',
      };
    }
    return {
      approach: `据主理人方向[${steer}]: 在 Brain 服务端缓存 daily-report(Redis,TTL 5min),前端只读 API`,
      files: ['apps/api/src/system/daily-report.ts', 'apps/api/src/shared/cache.ts'],
      tests: ['服务端集成测试: 缓存命中跳过重算、TTL 过期重算、并发只算一次'],
      risk: '需 Redis 连接降级(连不上回退直算)',
    };
  }

  // ── 真 LLM:失败/脏输出全降级回模板骨架,绝不抛 ──────────────────────
  try {
    const content = await callLLM(buildMessages(task, steer));
    const parsed = parseContract(content);
    if (!parsed) return templateContract(task, steer, true);
    return parsed;
  } catch {
    return templateContract(task, steer, true);
  }
}

export function renderContract(task, c, round) {
  return [
    `┌─ 方向闸 · 第 ${round} 版 Contract ───────────────────────`,
    `│ 活: ${task.title}`,
    `│ 打算怎么做: ${c.approach}`,
    `│ 动哪些文件: ${c.files.join(', ')}`,
    `│ 怎么验:     ${c.tests.join('; ')}`,
    `│ 已知风险:   ${c.risk}`,
    `└─ 请主理人裁决: [approve] 放行 / [redirect "<一句话方向>"] 掰回`,
  ].join('\n');
}
