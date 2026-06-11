/**
 * Contract Gate — spawn evaluator 前的确定性合同预检（零 LLM，单一来源）。
 *
 * 把"合同质量红线"（弱 oracle / 作弊 / 环境能力 / 领域规则）从 SKILL.md 的 LLM 自觉执行，
 * 下沉为 spawn LLM evaluator **之前**的代码层硬门禁：不合格合同直接拦截，不浪费一个
 * evaluator 容器（每个 ~$5-7）。
 *
 * 设计要点：
 *  - 数据化规则表（RULES 数组）：每条含 id / description / detect / feedback，新增规则只加一行。
 *  - 环境能力清单（ENV_CAPABILITY）：可配置，引用不可用二进制 → env_missing。
 *  - 纯 regex/解析，确定性、可单测；无 LLM、无网络、无副作用。
 *  - CLI（contract-gate-check.mjs）与 graph 节点（evaluateContractNode）共享 runContractGate（单一来源）。
 *
 * 返回契约（ground truth，禁止漂移字段名）：
 *   { ok, hits[{ruleId,line,excerpt,feedback,exempted}], exemptions[{ruleId,reason,matched}],
 *     envMissing[{tool,line,excerpt}] }
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 环境能力清单（可配置）。引用 unavailable 里的二进制 → env_missing。
 * 初值来自 PRD ASSUMPTION：evaluator 容器有 curl/jq/git/gh/node/python3/psql，
 * 没有 docker/ffprobe/playwright（后续可按 target_environment 调整）。
 */
export const ENV_CAPABILITY = {
  available: ['curl', 'jq', 'git', 'gh', 'node', 'python3', 'psql', 'bash'],
  unavailable: ['docker', 'ffprobe', 'playwright'],
};

/**
 * 数据化规则表。每条规则对单行验收脚本做确定性判定。
 * detect(line) → boolean；feedback(ctx) → string（{line}/{tool} 已替换）。
 */
export const RULES = [
  {
    id: 'weak-oracle/curl-no-jq',
    description: 'curl 取响应却无 jq -e 值校验',
    detect: (line) => /\bcurl\b/.test(line) && !/\bjq\s+-e\b/.test(line),
    feedback: ({ line }) =>
      `第 ${line} 行 curl 取响应但未 jq -e 校验字段值——加 | jq -e '.field == ...'`,
  },
  {
    id: 'cheat/mock-env',
    description: 'MOCK_* 环境变量注入假环境',
    detect: (line) => /\bMOCK_[A-Z0-9]/.test(line),
    feedback: ({ line }) => `第 ${line} 行注入 MOCK_*——删除，读真实环境`,
  },
  {
    id: 'cheat/exit-0-fallback',
    description: '无条件 exit 0 兜底',
    detect: (line) =>
      /\|\|\s*exit\s+0\b/.test(line) ||
      /\belse\s+exit\s+0\b/.test(line) ||
      /^\s*exit\s+0\s*;?\s*$/.test(line),
    feedback: ({ line }) => `第 ${line} 行无条件 exit 0 兜底——不可用即 FAIL，禁兜底`,
  },
  {
    id: 'cheat/or-true',
    description: '断言尾部 || true 吞错',
    detect: (line) => /\|\|\s*true\b/.test(line),
    feedback: ({ line }) => `第 ${line} 行 || true 吞掉失败 exit code——删除`,
  },
  {
    id: 'weak-oracle/file-existence-only',
    description: '只查文件存在/大小，无内容断言',
    detect: (line) =>
      /\btest\s+-[fes]\b/.test(line) || /\bls\s+-l\b/.test(line) || /\.size\b/.test(line),
    feedback: ({ line }) => `第 ${line} 行只查文件存在/大小——加内容/业务属性断言`,
  },
  {
    id: 'weak-oracle/tautology',
    description: '比较脚本自生成值的同义反复断言',
    detect: (line) => isTautology(line),
    feedback: ({ line }) => `第 ${line} 行断言对象是脚本自身输出——断言被测系统真实响应`,
  },
  {
    id: 'domain/db-no-time-window',
    description: '声明 DB 写入但 SELECT 无 created_at > NOW()-interval 时间窗',
    detect: (line) =>
      /\bpsql\b/.test(line) &&
      /\b(SELECT|count)\b/i.test(line) &&
      !/\binterval\b/i.test(line) &&
      !/NOW\s*\(\s*\)/i.test(line),
    feedback: ({ line }) =>
      `第 ${line} 行 DB 计数缺时间窗——加 AND created_at > NOW() - interval '5 minutes'`,
  },
];

/**
 * 同义反复检测（精确，避免误伤 `echo "$OUT" | grep "<真实期望>"`）：
 *  A. echo <字面量> | grep <相同字面量>（如 echo PASS | grep PASS）
 *  B. VAR=val …; [ "$VAR" = val ]（自赋值后比较同值）
 */
export function isTautology(line) {
  // 行过长（异常输入）跳过 Pattern B 的线性二次扫描，避免大输入阻塞（合同正常很短）
  if (line.length > 2000) return false;
  // A: echo LITERAL | grep [-flags] LITERAL，两个字面量相同 → 同义反复
  const a = line.match(
    /echo\s+(['"]?)([A-Za-z0-9_]+)\1\s*\|\s*grep\s+(?:-\w+\s+)*(['"]?)([A-Za-z0-9_]+)\3/
  );
  if (a && a[2] === a[4]) return true;
  // B: VAR=val ... [ "$VAR" = val ]
  const b = line.match(
    /\b([A-Za-z_]\w*)=([A-Za-z0-9_]+)\b.*\[\s*"?\$\{?([A-Za-z_]\w*)\}?"?\s*=\s*([A-Za-z0-9_]+)/
  );
  if (b && b[1] === b[3] && b[2] === b[4]) return true;
  return false;
}

/** 解析 gate-allow 行 → { ruleId, reason }（合同显式豁免单条规则的逃生口）。 */
function parseExemptions(lines) {
  const out = [];
  lines.forEach((line) => {
    const m = line.match(/gate-allow:\s*(\S+)\s*(.*)$/);
    if (m) out.push({ ruleId: m[1].trim(), reason: (m[2] || '').trim() });
  });
  return out;
}

// 验收行锚定：`Test:` 必须在行首（可带 bullet/checkbox 前缀），不接受散文句中的 "...Test: ..."。
const TEST_LINE_RE = /^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?Test:\s*/;
// 围栏开：```lang（整行仅此）；围栏闭：裸 ```（CommonMark 闭合栏不带 info string）。
const FENCE_OPEN_RE = /^\s*```(\w*)\s*$/;
const FENCE_CLOSE_RE = /^\s*```\s*$/;

/**
 * 标记每行是否为「验收命令行」（只对命令行跑规则，不误伤散文描述/标题）。
 * 命令行 = 行首 `Test:` 行，或 **成对闭合** 的 ```bash/sh/```（无 info）围栏块内的行。
 *
 * 健壮性（防自锁 + 防绕过）：
 *  - 闭合栏必须是裸 ```（带语言标签的行视为块内容，不当闭合）→ 防作弊者插 ```js 伪闭合藏后续命令。
 *  - 未闭合围栏（缺裸 ```）→ 整块降级为「非命令」，不无限延伸扫描散文 → 防散文里的红线说明自命中。
 * @returns {boolean[]}  与 lines 等长
 */
function markCommandLines(lines) {
  const result = new Array(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(FENCE_OPEN_RE);
    if (open) {
      const lang = (open[1] || '').toLowerCase();
      const scannable = lang === '' || /^(bash|sh|shell|console)$/.test(lang);
      // 找成对的裸闭合栏
      let j = i + 1;
      while (j < lines.length && !FENCE_CLOSE_RE.test(lines[j])) j++;
      if (j >= lines.length) break; // 未闭合 → 降级，剩余行一律不当命令（防自锁）
      if (scannable) for (let k = i + 1; k < j; k++) result[k] = true;
      i = j + 1;
      continue;
    }
    if (TEST_LINE_RE.test(lines[i])) result[i] = true;
    i += 1;
  }
  return result;
}

/**
 * 对一段合同文本做确定性 gate 判定（不读盘，便于单测）。
 * @param {string} text  合同（contract-dod.md）内容
 * @param {object} [opts]  { envCapability }
 * @returns {{ok:boolean, hits:object[], exemptions:object[], envMissing:object[]}}
 */
export function evaluateContractText(text, opts = {}) {
  const envCap = opts.envCapability || ENV_CAPABILITY;
  const lines = String(text == null ? '' : text).split('\n');

  const exemptions = parseExemptions(lines);
  const exemptIds = new Set(exemptions.map((e) => e.ruleId));

  // 只对验收命令行跑规则（Test: 行 / bash 围栏块），不误伤散文描述
  const isCommand = markCommandLines(lines);
  const hasAssertion = isCommand.some(Boolean);

  const hits = [];
  const envMissing = [];

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine;
    if (!isCommand[idx]) return; // 非命令行（标题/散文/bullet 描述）跳过，防误命中
    // gate-allow 行本身不参与规则检测（它是元数据，不是验收脚本）
    if (/gate-allow:/.test(line)) return;
    const excerpt = line.trim().slice(0, 160);

    for (const rule of RULES) {
      if (rule.detect(line)) {
        hits.push({
          ruleId: rule.id,
          line: lineNo,
          excerpt,
          feedback: rule.feedback({ line: lineNo }),
          exempted: exemptIds.has(rule.id),
        });
      }
    }

    // 工具 preflight：引用环境能力清单外的二进制（仅命令位置，排除 URL/路径/镜像名子串）
    // 例：https://playwright.dev、docker.io/img、/usr/bin/foo-docker 不算「引用该二进制」。
    for (const tool of envCap.unavailable) {
      if (new RegExp(`(?<![\\w./-])${tool}(?![\\w.-])`).test(line)) {
        envMissing.push({
          ruleId: 'env-missing',
          tool,
          line: lineNo,
          excerpt,
          exempted: exemptIds.has('env-missing') || exemptIds.has(`env-missing/${tool}`),
        });
      }
    }
  });

  // 结构性：无任何可验收断言 → 不合格（空脚本/无命令）
  if (!hasAssertion) {
    hits.push({
      ruleId: 'structural/no-assertion',
      line: 0,
      excerpt: '(无验收命令)',
      feedback: '合同无可验收断言——不合格',
      exempted: exemptIds.has('structural/no-assertion'),
    });
  }

  // 豁免留痕：标记每条豁免是否真命中了某条 hit / env_missing（不存在的 rule-id → matched=false，不静默吞掉）
  for (const ex of exemptions) {
    ex.matched =
      hits.some((h) => h.ruleId === ex.ruleId) ||
      envMissing.some((e) => e.ruleId === ex.ruleId || `env-missing/${e.tool}` === ex.ruleId);
  }

  const unexempted = hits.filter((h) => !h.exempted);
  const unexemptedEnv = envMissing.filter((e) => !e.exempted);
  const ok = unexempted.length === 0 && unexemptedEnv.length === 0;

  return { ok, hits, exemptions, envMissing };
}

/**
 * 读取 fixtureDir 下的合同并跑 gate（单一来源；CLI 与 graph 节点共享）。
 * fail-closed：目录/文件不可读 → throw（调用方决定退出码；CLI 据此非零退出）。
 *
 * @param {string} fixtureDir  含 contract-dod.md（或 contract-draft.md）的目录
 * @param {object} [opts]  { contractFile, envCapability, readFile }
 * @returns {Promise<{ok:boolean, hits:object[], exemptions:object[], envMissing:object[], contractFile:string}>}
 */
export async function runContractGate(fixtureDir, opts = {}) {
  if (!fixtureDir || typeof fixtureDir !== 'string') {
    throw new Error('runContractGate: fixtureDir 必填（fail-closed）');
  }
  const readFile = opts.readFile || ((p) => fs.promises.readFile(p, 'utf8'));

  let contractFile = opts.contractFile;
  if (!contractFile) {
    const candidates = [
      path.join(fixtureDir, 'contract-dod.md'),
      path.join(fixtureDir, 'contract-draft.md'),
    ];
    contractFile = candidates.find((p) => fs.existsSync(p));
    if (!contractFile) {
      // fail-closed：没有可读合同绝不放行
      throw new Error(
        `runContractGate: ${fixtureDir} 下无 contract-dod.md / contract-draft.md（fail-closed）`
      );
    }
  }

  const text = await readFile(contractFile);
  const res = evaluateContractText(text, opts);
  return { ...res, contractFile };
}

/**
 * 把 gate 结果格式化成人类可读 + 可 grep 的报告（CLI stdout / 节点 feedback 共用）。
 * - 每条未豁免命中：`HIT <ruleId> <file>:<line> — <excerpt>`
 * - 每条豁免：`EXEMPT <ruleId> (gate-allow, matched=<bool>) — <reason>`（留痕）
 * - 每条 env_missing：`env_missing: <tool> <file>:<line> — <excerpt>`
 */
export function formatGateReport(result, fileLabel = 'contract-dod.md') {
  const out = [];
  for (const h of result.hits || []) {
    if (h.exempted) continue;
    out.push(`HIT ${h.ruleId} ${fileLabel}:${h.line} — ${h.excerpt}  | ${h.feedback}`);
  }
  for (const ex of result.exemptions || []) {
    out.push(
      `EXEMPT ${ex.ruleId} (gate-allow, matched=${ex.matched}) — 豁免理由: ${ex.reason || '(未填)'}`
    );
  }
  for (const em of result.envMissing || []) {
    if (em.exempted) continue;
    out.push(`env_missing: ${em.tool} ${fileLabel}:${em.line} — ${em.excerpt}`);
  }
  return out.join('\n');
}
