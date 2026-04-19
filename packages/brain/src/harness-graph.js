/**
 * Harness LangGraph — Docker-backed pipeline
 *
 * 替代 routes/execution.js + harness-watcher.js 中手写的 6 阶段状态机。
 * 节点：planner → proposer → reviewer → generator → evaluator → report
 * 条件边：
 *   - reviewer: APPROVED → generator, REVISION → proposer（GAN 循环，无上限）
 *   - evaluator: PASS → report, FAIL → generator（Fix 循环，无上限）
 *
 * 每个节点通过 executeInDocker() 在隔离容器中运行 Claude Code session。
 * Docker 输出解析为 JSON（claude --output-format json），提取 result 字段更新 state。
 *
 * 用法：
 *   import { buildHarnessGraph, compileHarnessApp, createDockerNodes } from './harness-graph.js';
 *   const nodes = createDockerNodes(executeInDocker, task);
 *   const app = compileHarnessApp({ overrides: nodes });
 *   for await (const ev of app.stream(initialState, { configurable: { thread_id: taskId } })) { ... }
 */

import { StateGraph, START, END, Annotation, MemorySaver } from '@langchain/langgraph';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

// ─── Skill 内联加载 ──────────────────────────────────────────────────────────
// Docker 容器里 Claude Code headless (-p) 模式不识别 `/skill-name` 语法，
// 必须把 SKILL.md 原文内联到 prompt 里，Claude 才能按 skill 指令工作。
const SKILL_SEARCH_DIRS = [
  path.join(os.homedir(), '.claude-account1', 'skills'),
  path.join(os.homedir(), '.claude-account2', 'skills'),
  path.join(os.homedir(), '.claude', 'skills'),
];

const _skillCache = new Map();

/**
 * 读取 skill 的 SKILL.md 内容（缓存）。
 * 优先查 ~/.claude-account1/skills/<name>/SKILL.md。
 * 找不到返回空串（不抛错，让 prompt 能回退）。
 */
export function loadSkillContent(skillName) {
  if (_skillCache.has(skillName)) return _skillCache.get(skillName);
  for (const base of SKILL_SEARCH_DIRS) {
    const p = path.join(base, skillName, 'SKILL.md');
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf8');
        _skillCache.set(skillName, content);
        return content;
      } catch { /* continue */ }
    }
  }
  _skillCache.set(skillName, '');
  return '';
}

/**
 * Harness 状态 schema
 *
 * 多 Workstream 模型（2026-04-19 升级）：
 *   合同（sprint-contract.md）里 `## Workstreams` 区块分出 WS1/WS2/WS3...
 *   每个 WS 对应一个独立 PR（generator 循环产）；evaluator 对每个 PR 单独验收；
 *   Fix 循环只重跑 FAIL 的 WS，PASS 的 PR 保留不动。
 *
 * 字段说明（全部可选）：
 *  - task_id           关联的 Brain 任务 ID（也用作 langgraph thread_id）
 *  - task_description  原始用户需求
 *  - sprint_dir        sprints/ 目录
 *  - prd_content       Layer 1 planner 输出
 *  - contract_content  Layer 2a proposer 输出
 *  - review_verdict    Layer 2b reviewer 裁决：'APPROVED' | 'REVISION'
 *  - review_feedback   reviewer REVISION 时的反馈内容
 *  - review_round      review 回合计数（debug 用）
 *  - acceptance_criteria  proposer 输出的 Given-When-Then 验收标准
 *  - workstreams       Layer 2a proposer 解析的 WS 列表
 *                      每项形如 { index, name, dod_file?, description? }
 *  - pr_urls           Layer 3 generator 按 WS 顺序产出的 PR URL 数组
 *  - ws_verdicts       Layer 3c evaluator 对每个 PR 的裁决数组（PASS/FAIL，index 对齐 pr_urls）
 *  - ws_feedbacks      Layer 3c evaluator 对每个 PR FAIL 时的反馈数组（index 对齐）
 *  - pr_url            向后兼容：= pr_urls[0]
 *  - pr_branch         向后兼容：首个 WS 的 PR 分支名
 *  - evaluator_verdict 向后兼容：全部 ws_verdicts 为 PASS 时 = 'PASS'，否则 'FAIL'
 *  - eval_feedback     向后兼容：所有 FAIL WS feedback 汇总
 *  - eval_round        evaluator 回合计数
 *  - report_path       Layer 4 report 输出
 *  - trace             节点执行轨迹（debug 用，reducer 累加）
 *  - error             错误信息（节点失败时写入）
 */
export const HarnessState = Annotation.Root({
  task_id: Annotation,
  task_description: Annotation,
  sprint_dir: Annotation,
  prd_content: Annotation,
  contract_content: Annotation,
  review_verdict: Annotation,
  review_feedback: Annotation,
  review_round: Annotation,
  acceptance_criteria: Annotation,
  // ── 多 WS 字段 ────────────────────────────────────────────────────────────
  workstreams: Annotation,
  pr_urls: Annotation,
  pr_branches: Annotation,
  ws_verdicts: Annotation,
  ws_feedbacks: Annotation,
  // ── 向后兼容字段（填 workstreams[0] 语义）────────────────────────────────
  pr_url: Annotation,
  pr_branch: Annotation,
  evaluator_verdict: Annotation,
  eval_feedback: Annotation,
  eval_round: Annotation,
  report_path: Annotation,
  error: Annotation,
  trace: Annotation({
    reducer: (left, right) => {
      const a = Array.isArray(left) ? left : [];
      const b = Array.isArray(right) ? right : (right ? [right] : []);
      return [...a, ...b];
    },
    default: () => [],
  }),
});

/**
 * Placeholder node factory.
 * 用于测试或 HARNESS_LANGGRAPH_ENABLED=false 时的降级模式。
 *
 * @param {string} label                    节点名（写入 trace）
 * @param {(state) => object} [stateUpdate] 可选：节点附加到 state 上的字段
 * @returns {(state) => Promise<object>}
 */
export function placeholderNode(label, stateUpdate) {
  return async (state) => {
    const update = typeof stateUpdate === 'function' ? (stateUpdate(state) || {}) : {};
    return { ...update, trace: label };
  };
}

// ─── Docker 输出解析 ─────────────────────────────────────────────────────────

/**
 * 解析 claude --output-format json 的 stdout。
 * Claude CLI JSON 输出格式：最后一个 JSON 对象包含 result 字段。
 * 兼容多行输出（streaming chunks + final result）。
 *
 * @param {string} stdout  Docker container stdout
 * @returns {string}       提取的文本内容（result 字段或 raw stdout）
 */
export function parseDockerOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return '';
  const trimmed = stdout.trim();
  if (!trimmed) return '';

  // 尝试从末尾找最后一个完整 JSON 对象
  // claude --output-format json 输出的最后一段是 {"type":"result","result":"..."}
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.result) return typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result);
      if (obj.content) return typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
      // 其他 JSON — 返回整行
      return line;
    } catch {
      continue;
    }
  }

  // 非 JSON 输出 — 返回最后 4000 字符
  return trimmed.slice(-4000);
}

/**
 * 从 Docker 输出中提取特定字段值（正则匹配）。
 * 支持 key: value 和 **key**: value 格式。
 * 值截止到换行符或下一个已知字段标记（key:）。
 */
export function extractField(text, fieldName) {
  if (!text) return null;
  // 匹配 "field_name: value" 或 "**field_name**: value"
  // 值截止到换行或下一个 word: 模式（避免吃掉同行后续字段）
  const re = new RegExp(`(?:\\*\\*)?${fieldName}(?:\\*\\*)?:\\s*(.+?)(?:\\s+\\w+:|\\n|$)`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/**
 * 从 Docker 输出中提取裁决（APPROVED/REVISION/PASS/FAIL）。
 * 优先匹配显式标记（verdict: / 裁决: / VERDICT:），其次匹配全文中的关键词。
 */
export function extractVerdict(text, validValues) {
  if (!text) return null;
  const upper = text.toUpperCase();

  // 优先：显式 verdict 字段
  const verdictMatch = upper.match(/(?:VERDICT|裁决|REVIEW_VERDICT|EVALUATOR_VERDICT)\s*[:=]\s*([\w]+)/);
  if (verdictMatch) {
    const v = verdictMatch[1];
    if (validValues.includes(v)) return v;
  }

  // 次选：全文关键词（从后往前扫描，取最后出现的）
  let lastIdx = -1;
  let lastVal = null;
  for (const val of validValues) {
    const idx = upper.lastIndexOf(val);
    if (idx > lastIdx) {
      lastIdx = idx;
      lastVal = val;
    }
  }
  return lastVal;
}

/**
 * 从合同正文中解析 `## Workstreams` 区块，得到 workstream 列表。
 *
 * 支持的行格式（容错多种写法）：
 *   - `**WS-1** name: docker_runtime_probe`
 *   - `- **WS1**: docker_runtime_probe`
 *   - `- WS1 — docker_runtime_probe`
 *   - `- WS-1: docker_runtime_probe (dod: sprints/contract-dod-ws1.md)`
 *
 * 返回数组；每项 `{ index, name, dod_file?, description? }`。
 * 若合同没有 `## Workstreams` 区块或区块为空，返回
 *   `[{ index: 1, name: 'default' }]`（单 WS 兜底，保向后兼容）。
 *
 * 解析只看第一个 `## Workstreams` 到下一个 `## ` 之间的行；
 * 遇到更小级别（`###`）允许作为子项跳过；嵌套解析非目标，保守处理。
 *
 * @param {string} contract  合同 markdown 原文
 * @returns {Array<{index:number, name:string, dod_file?:string, description?:string}>}
 */
export function parseWorkstreams(contract) {
  const DEFAULT = [{ index: 1, name: 'default' }];
  if (!contract || typeof contract !== 'string') return DEFAULT;

  // 取 ## Workstreams 到下一个 ## 之间的段落（大小写/全角冒号都兼容）
  const headRe = /^##\s+(?:Workstreams|workstreams|WORKSTREAMS|工作流|WS 列表)\s*$/im;
  const headMatch = contract.match(headRe);
  if (!headMatch) return DEFAULT;

  const startIdx = headMatch.index + headMatch[0].length;
  const rest = contract.slice(startIdx);
  // 下一个 `## ` 或 EOF
  const nextHead = rest.match(/\n##\s+\S/);
  const section = nextHead ? rest.slice(0, nextHead.index) : rest;

  // 行内匹配
  //   WS[-]?\d+ 之后可选 name 和 dod_file
  //   name 取 `WS?\d+` 之后到行尾/括号前的第一段
  const lineRe = /^\s*(?:-|\*)?\s*(?:\*\*)?WS[-\s]?(\d+)(?:\*\*)?\s*(?:[:：—–-]\s*)?([^(\n]*?)\s*(?:\(([^)]*)\))?\s*$/gm;

  const list = [];
  let match;
  while ((match = lineRe.exec(section)) !== null) {
    const index = parseInt(match[1], 10);
    const rawName = (match[2] || '').trim();
    const parens = (match[3] || '').trim();

    if (!Number.isFinite(index) || index <= 0) continue;

    // 提取 dod_file（括号里 `dod: <path>` 或 `contract-dod-wsN.md`）
    let dodFile = null;
    if (parens) {
      const dodMatch = parens.match(/(?:dod[_-]?file|dod)\s*[:=]\s*([^\s,]+)/i);
      if (dodMatch) dodFile = dodMatch[1];
      else if (/\.md$/i.test(parens)) dodFile = parens.split(/\s|,/)[0];
    }

    // 从 name 里再抽一次 "contract-dod-wsN.md"（有的合同直接把路径写在 name 里）
    if (!dodFile) {
      const inlineDod = rawName.match(/([^\s]+contract-dod-ws\d+\.md)/i);
      if (inlineDod) dodFile = inlineDod[1];
    }

    // 清理 name：去掉路径 / 末尾标点
    let name = rawName
      .replace(/contract-dod-ws\d+\.md/gi, '')
      .replace(/^[\s:：—–,-]+|[\s:：—–,.]+$/g, '')
      .trim();
    if (!name) name = `ws-${index}`;

    // 同 index 已存在则跳过（第一次为准）
    if (list.some(w => w.index === index)) continue;

    list.push({
      index,
      name,
      ...(dodFile ? { dod_file: dodFile } : {}),
    });
  }

  if (list.length === 0) return DEFAULT;

  // 按 index 升序
  list.sort((a, b) => a.index - b.index);
  return list;
}

// ─── Docker Node Factory ─────────────────────────────────────────────────────

/**
 * 创建接入 Docker 的真实节点集合。
 *
 * @param {Function} dockerExecutor  executeInDocker 函数
 * @param {Object}   task            Brain 任务对象（含 id, task_type, payload 等）
 * @param {Object}   [opts]
 * @param {Record<string,string>} [opts.env]  额外注入容器的环境变量
 * @returns {Object}                 节点 map: { planner, proposer, reviewer, generator, evaluator, report }
 */
export function createDockerNodes(dockerExecutor, task, opts = {}) {
  const baseEnv = opts.env || {};
  const taskId = task.id;

  /**
   * 通用 Docker 节点执行器。
   * 构建 prompt → 调 executeInDocker → 解析输出 → 返回 state 更新。
   */
  async function runDockerNode(nodeName, taskType, prompt, state) {
    console.log(`[harness-graph] node=${nodeName} task=${taskId} starting docker execution`);
    const startMs = Date.now();

    try {
      const result = await dockerExecutor({
        task: { ...task, task_type: taskType },
        prompt,
        env: {
          ...baseEnv,
          CECELIA_TASK_TYPE: taskType,
          HARNESS_NODE: nodeName,
          HARNESS_SPRINT_DIR: state.sprint_dir || 'sprints',
        },
      });

      const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
      const success = result.exit_code === 0 && !result.timed_out;
      console.log(
        `[harness-graph] node=${nodeName} task=${taskId} exit=${result.exit_code} timed_out=${result.timed_out} duration=${durationSec}s`
      );

      if (!success) {
        const errMsg = result.timed_out
          ? `Docker timeout after ${durationSec}s`
          : `Docker exit code ${result.exit_code}: ${(result.stderr || '').slice(-500)}`;
        return { output: '', error: errMsg, success: false };
      }

      const output = parseDockerOutput(result.stdout);
      return { output, error: null, success: true };
    } catch (err) {
      console.error(`[harness-graph] node=${nodeName} task=${taskId} error: ${err.message}`);
      return { output: '', error: err.message, success: false };
    }
  }

  // ── Planner 节点 ──────────────────────────────────────────────────────────
  const planner = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const skillContent = loadSkillContent('harness-planner');
    const prompt = `你是 harness-planner agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}

## 任务描述
${state.task_description || ''}

## 输出要求
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. 包含 User Stories / Given-When-Then / FR-SC 编号 / OKR 对齐 / 假设 / 边界 / 范围限定 / 受影响文件
3. 在 stdout 最后输出完整 PRD 内容`;

    const { output, error } = await runDockerNode('planner', 'harness_planner', prompt, state);
    return {
      prd_content: output || null,
      error: error || null,
      trace: `planner${error ? '(ERROR)' : ''}`,
    };
  };

  // ── Proposer 节点 ─────────────────────────────────────────────────────────
  const proposer = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const round = (state.review_round || 0) + 1;
    const reviewFeedback = state.review_feedback
      ? `\n\n## Reviewer 反馈（Round ${round - 1}）\n${state.review_feedback}`
      : '';

    const skillContent = loadSkillContent('harness-contract-proposer');
    const prompt = `你是 harness-contract-proposer agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**propose_round**: ${round}

## PRD 内容
${state.prd_content || '（PRD 未生成）'}
${reviewFeedback}

## 输出要求
1. 生成合同草案，包含功能范围 + Workstreams 拆分 + DoD 条目 + 验证命令
2. 生成 Given-When-Then 验收标准
3. 在 stdout 输出完整合同内容和验收标准
4. 验收标准以 "ACCEPTANCE_CRITERIA:" 标记开头`;

    const { output, error } = await runDockerNode('proposer', 'harness_contract_propose', prompt, state);

    // 提取验收标准
    let acceptanceCriteria = null;
    if (output) {
      const acIdx = output.indexOf('ACCEPTANCE_CRITERIA:');
      if (acIdx >= 0) {
        acceptanceCriteria = output.slice(acIdx + 'ACCEPTANCE_CRITERIA:'.length).trim();
      } else {
        // 如果没有显式标记，整个输出作为合同+标准
        acceptanceCriteria = output;
      }
    }

    // 解析合同中的 ## Workstreams 区块
    // 若合同没有该区块 → 降级为单 WS（保向后兼容，行为和老版一致）
    const workstreams = parseWorkstreams(output || '');
    console.log(
      `[harness-graph] proposer parsed workstreams count=${workstreams.length} task=${taskId}: ${workstreams.map(w => `WS${w.index}(${w.name})`).join(', ')}`
    );

    return {
      contract_content: output || null,
      acceptance_criteria: acceptanceCriteria,
      workstreams,
      review_round: round,
      error: error || null,
      trace: `proposer(R${round},ws=${workstreams.length})${error ? '(ERROR)' : ''}`,
    };
  };

  // ── Reviewer 节点 ─────────────────────────────────────────────────────────
  const reviewer = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const round = state.review_round || 1;

    const skillContent = loadSkillContent('harness-contract-reviewer');
    const prompt = `你是 harness-contract-reviewer agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**review_round**: ${round}

## PRD 内容
${state.prd_content || '（PRD 未生成）'}

## 合同草案
${state.contract_content || '（合同未生成）'}

## 验收标准（Given-When-Then）
${state.acceptance_criteria || '（验收标准未生成）'}

## 审查要求
1. 挑战验收标准是否足够严格，能否检测出错误实现
2. 验证命令是否可自动执行（不依赖人工）
3. DoD 条目是否完整覆盖 PRD 需求
4. 输出裁决：VERDICT: APPROVED 或 VERDICT: REVISION
5. REVISION 时必须给出具体修改建议

注意：如果合同基本满足 PRD 要求、DoD 可验证、验证命令可自动执行，应直接 APPROVED 进入 Generator。避免无限挑剔导致对抗循环无法收敛。`;

    const { output, error } = await runDockerNode('reviewer', 'harness_contract_review', prompt, state);

    const verdict = error
      ? 'REVISION'  // Docker 失败时视为需要修订
      : (extractVerdict(output, ['APPROVED', 'REVISION']) || 'APPROVED');
    const feedback = verdict === 'REVISION' ? (output || error || '') : null;

    console.log(`[harness-graph] reviewer verdict=${verdict} round=${round} task=${taskId}`);

    return {
      review_verdict: verdict,
      review_feedback: feedback,
      error: error || null,
      trace: `reviewer(R${round}:${verdict})${error ? '(ERROR)' : ''}`,
    };
  };

  // ── Generator 节点（按 WS 循环产多 PR）────────────────────────────────────
  const generator = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const evalRound = state.eval_round || 0;
    const isFixMode = evalRound > 0;

    // Workstreams 列表 — proposer 已填，若缺失兜底单 WS
    const workstreams = Array.isArray(state.workstreams) && state.workstreams.length > 0
      ? state.workstreams
      : [{ index: 1, name: 'default' }];

    // 起点：上轮 pr_urls（数组 index 对齐 workstreams 下标）
    const existingPRs = Array.isArray(state.pr_urls) ? [...state.pr_urls] : [];
    const existingBranches = Array.isArray(state.pr_branches) ? [...state.pr_branches] : [];

    // Fix 模式只跑上轮 FAIL 的 WS；首轮全跑
    let targetIndexes;
    if (isFixMode && Array.isArray(state.ws_verdicts) && state.ws_verdicts.length > 0) {
      targetIndexes = state.ws_verdicts
        .map((v, i) => (v !== 'PASS' ? i : -1))
        .filter(i => i >= 0);
      // 如果 Fix 模式但没有任何 FAIL（异常），兜底 re-run 全部（不应发生，图会路由到 report）
      if (targetIndexes.length === 0) targetIndexes = workstreams.map((_, i) => i);
    } else {
      targetIndexes = workstreams.map((_, i) => i);
    }

    console.log(
      `[harness-graph] generator starting task=${taskId} mode=${isFixMode ? 'fix' : 'new'} ` +
      `ws_total=${workstreams.length} ws_to_run=${targetIndexes.length} indexes=[${targetIndexes.join(',')}]`
    );

    const skillContent = loadSkillContent('harness-generator');
    const newPRs = [...existingPRs];
    const newBranches = [...existingBranches];
    let combinedError = null;

    for (const wsIndex of targetIndexes) {
      const ws = workstreams[wsIndex] || { index: wsIndex + 1, name: `ws-${wsIndex + 1}` };
      const wsLabel = `WS-${ws.index}(${ws.name})`;
      const wsEvalFeedback = isFixMode && Array.isArray(state.ws_feedbacks)
        ? (state.ws_feedbacks[wsIndex] || '')
        : '';
      const evalFeedback = isFixMode && wsEvalFeedback
        ? `\n\n## Evaluator 反馈（Round ${evalRound}，${wsLabel}）\n${wsEvalFeedback}`
        : '';

      const prompt = `你是 harness-generator agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**task_type**: ${isFixMode ? 'harness_fix' : 'harness_generate'}
**workstream_index**: ${ws.index}
**workstream_name**: ${ws.name}
**workstream_total**: ${workstreams.length}
${ws.dod_file ? `**workstream_dod_file**: ${ws.dod_file}` : ''}
${isFixMode ? `**eval_round**: ${evalRound}` : ''}

## 工作范围限定（CRITICAL）
本次你只负责实现 **${wsLabel}**（合同 \`## Workstreams\` 区块里的第 ${ws.index} 条）。
${ws.dod_file ? `对应 DoD 文件：\`${ws.dod_file}\`（严格按此条约验收）` : ''}

- 只改动该 workstream 涵盖的代码/测试，其他 WS 的代码一行不动。
- 单独 push 一个 PR，分支名必须包含 \`ws${ws.index}\`（例如 \`cp-NNNNNNNN-xxxx-ws${ws.index}\`）。
- 不要把多个 WS 打包进一个 PR。

## PRD 内容
${state.prd_content || '（PRD 未生成）'}

## 合同内容（GAN 已批准，含全部 WS）
${state.contract_content || '（合同未生成）'}

## 验收标准（Given-When-Then）
${state.acceptance_criteria || '（验收标准未生成）'}
${evalFeedback}

## 执行要求
1. 严格按合同的 ${wsLabel} 范围实现，不越界
2. 代码写完后 push 一个独立 PR（分支名含 \`ws${ws.index}\`）
3. 在 stdout 输出 \`pr_url: <URL>\` 和 \`pr_branch: <branch>\``;

      const { output, error } = await runDockerNode(
        'generator',
        isFixMode ? 'harness_fix' : 'harness_generate',
        prompt,
        state,
      );

      const prUrl = extractField(output, 'pr_url');
      const prBranch = extractField(output, 'pr_branch');
      if (prUrl) newPRs[wsIndex] = prUrl;
      if (prBranch) newBranches[wsIndex] = prBranch;

      if (error) {
        combinedError = combinedError ? `${combinedError}\n${wsLabel}: ${error}` : `${wsLabel}: ${error}`;
      }
      console.log(
        `[harness-graph] generator task=${taskId} ${wsLabel} done pr=${prUrl || 'none'} branch=${prBranch || 'none'}${error ? ' error=' + error.slice(0, 80) : ''}`
      );
    }

    return {
      // 新字段
      pr_urls: newPRs,
      pr_branches: newBranches,
      workstreams,  // re-emit 避免反序列化/降级时丢
      // 老字段（向后兼容 — 首个 WS 的产出）
      pr_url: newPRs[0] || state.pr_url || null,
      pr_branch: newBranches[0] || state.pr_branch || null,
      error: combinedError,
      trace: `generator(${isFixMode ? 'fix-R' + evalRound : 'gen'},ws=${targetIndexes.length}/${workstreams.length})${combinedError ? '(ERROR)' : ''}`,
    };
  };

  // ── Evaluator 节点（按 WS PR 循环验收）────────────────────────────────────
  const evaluator = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const round = (state.eval_round || 0) + 1;

    // 源数据：workstreams + pr_urls
    const workstreams = Array.isArray(state.workstreams) && state.workstreams.length > 0
      ? state.workstreams
      : [{ index: 1, name: 'default' }];
    const prUrls = Array.isArray(state.pr_urls) && state.pr_urls.length > 0
      ? state.pr_urls
      : (state.pr_url ? [state.pr_url] : []);
    const prBranches = Array.isArray(state.pr_branches)
      ? state.pr_branches
      : (state.pr_branch ? [state.pr_branch] : []);

    // 上轮结果：保留已 PASS 的 WS，仅重验 FAIL 或未验过的
    const existingVerdicts = Array.isArray(state.ws_verdicts) ? [...state.ws_verdicts] : [];
    const existingFeedbacks = Array.isArray(state.ws_feedbacks) ? [...state.ws_feedbacks] : [];

    const skillContent = loadSkillContent('harness-evaluator');
    const verdicts = [];
    const feedbacks = [];
    let combinedError = null;

    const total = workstreams.length;
    console.log(
      `[harness-graph] evaluator starting task=${taskId} round=${round} ws_total=${total} pr_urls=${prUrls.length}`
    );

    for (let i = 0; i < total; i++) {
      const ws = workstreams[i];
      const prUrl = prUrls[i] || null;
      const prBranch = prBranches[i] || null;
      const wsLabel = `WS-${ws.index}(${ws.name})`;

      // 已在上轮 PASS 的 WS，不再重验（保留 verdict，feedback 清 null）
      if (existingVerdicts[i] === 'PASS') {
        verdicts.push('PASS');
        feedbacks.push(null);
        console.log(`[harness-graph] evaluator task=${taskId} ${wsLabel} skipped (already PASS)`);
        continue;
      }

      // 没 PR 的 WS（generator 失败）直接 FAIL
      if (!prUrl) {
        verdicts.push('FAIL');
        feedbacks.push(`Generator 未产出 ${wsLabel} 的 PR`);
        console.log(`[harness-graph] evaluator task=${taskId} ${wsLabel} FAIL (no PR)`);
        continue;
      }

      const prompt = `你是 harness-evaluator agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**workstream_index**: ${ws.index}
**workstream_name**: ${ws.name}
**workstream_total**: ${total}
${ws.dod_file ? `**workstream_dod_file**: ${ws.dod_file}` : ''}
**pr_url**: ${prUrl}
**pr_branch**: ${prBranch || ''}
**eval_round**: ${round}

## 验收范围限定（CRITICAL）
本次你只负责验收 **${wsLabel}** 对应的 PR（${prUrl}）。
${ws.dod_file ? `严格按 \`${ws.dod_file}\` 的 DoD 条目逐条验证。` : ''}
其他 WS 的 PR 本轮不验收，另轮处理。

## 合同内容（含全部 WS，只关心 WS-${ws.index} 部分）
${state.contract_content || '（合同未生成）'}

## 验收标准（Given-When-Then）
${state.acceptance_criteria || '（验收标准未生成）'}

## 目标
部署服务（重启 Brain / Dashboard），然后对照合同验收标准进行 E2E 功能验收。
用 curl 验证 API，用 Playwright/浏览器验证前端。你的工作是找到失败，不是确认成功。
写入 ${sprintDir}/eval-round-${round}-ws${ws.index}.md。
输出裁决：VERDICT: PASS 或 VERDICT: FAIL`;

      const { output, error } = await runDockerNode('evaluator', 'harness_evaluate', prompt, state);

      const verdict = error
        ? 'FAIL'
        : (extractVerdict(output, ['PASS', 'FAIL']) || 'PASS');
      const feedback = verdict === 'FAIL' ? (output || error || '') : null;

      verdicts.push(verdict);
      feedbacks.push(feedback);
      if (error) {
        combinedError = combinedError ? `${combinedError}\n${wsLabel}: ${error}` : `${wsLabel}: ${error}`;
      }
      console.log(`[harness-graph] evaluator task=${taskId} ${wsLabel} verdict=${verdict}`);
    }

    const allPassed = verdicts.length > 0 && verdicts.every(v => v === 'PASS');
    const overallVerdict = allPassed ? 'PASS' : 'FAIL';
    const overallFeedback = allPassed
      ? null
      : verdicts
        .map((v, i) => v === 'FAIL' ? `## WS-${workstreams[i]?.index ?? i + 1} (${workstreams[i]?.name ?? ''})\n${feedbacks[i] || ''}` : null)
        .filter(Boolean)
        .join('\n\n---\n\n');

    console.log(
      `[harness-graph] evaluator done task=${taskId} round=${round} overall=${overallVerdict} verdicts=[${verdicts.join(',')}]`
    );
    // 参考 existingFeedbacks，避免"已在旧 state 里、本轮未重验"的那些 FAIL 被清洗（我们上面已保留）
    // existingFeedbacks 目前只用于旁路跟踪，未来可扩展为增量日志
    void existingFeedbacks;

    return {
      // 新字段
      ws_verdicts: verdicts,
      ws_feedbacks: feedbacks,
      workstreams,  // re-emit
      // 老字段（向后兼容）
      evaluator_verdict: overallVerdict,
      eval_round: round,
      eval_feedback: overallFeedback,
      error: combinedError,
      trace: `evaluator(R${round}:${overallVerdict},pass=${verdicts.filter(v => v === 'PASS').length}/${verdicts.length})${combinedError ? '(ERROR)' : ''}`,
    };
  };

  // ── Report 节点 ───────────────────────────────────────────────────────────
  const report = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';

    const skillContent = loadSkillContent('harness-report');
    const prompt = `你是 harness-report agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**pr_url**: ${state.pr_url || ''}

## Pipeline 执行轨迹
${(state.trace || []).join(' → ')}

## PRD 摘要
${(state.prd_content || '').slice(0, 2000)}

## GAN 对抗轮次
review_round: ${state.review_round || 0}
review_verdict: ${state.review_verdict || 'N/A'}

## Evaluator 轮次
eval_round: ${state.eval_round || 0}
evaluator_verdict: ${state.evaluator_verdict || 'N/A'}

## 任务
生成完整报告，包含：PRD 目标 / GAN 对抗轮次 / 代码生成 / CI 状态 / Evaluator 轮次 / 成本统计。
输出 report_path: <path>`;

    const { output, error } = await runDockerNode('report', 'harness_report', prompt, state);
    const reportPath = extractField(output, 'report_path') || `${sprintDir}/harness-report.md`;

    return {
      report_path: reportPath,
      error: error || null,
      trace: `report${error ? '(ERROR)' : ''}`,
    };
  };

  return { planner, proposer, reviewer, generator, evaluator, report };
}

/**
 * 构造 harness graph（未编译）。
 *
 * 暴露未编译的 builder，让测试可以注入自定义节点
 * 来覆盖条件边路径，不必真正调用 Docker executor。
 *
 * @param {object} [overrides]   节点 override map: { planner, proposer, ... }
 * @returns {StateGraph}         未编译的 StateGraph 实例
 */
export function buildHarnessGraph(overrides = {}) {
  const nodes = {
    planner: overrides.planner || placeholderNode('planner'),
    proposer: overrides.proposer || placeholderNode('proposer'),
    reviewer: overrides.reviewer || placeholderNode('reviewer', () => ({ review_verdict: 'APPROVED' })),
    generator: overrides.generator || placeholderNode('generator'),
    evaluator: overrides.evaluator || placeholderNode('evaluator', () => ({ evaluator_verdict: 'PASS' })),
    report: overrides.report || placeholderNode('report'),
  };

  const graph = new StateGraph(HarnessState)
    .addNode('planner', nodes.planner)
    .addNode('proposer', nodes.proposer)
    .addNode('reviewer', nodes.reviewer)
    .addNode('generator', nodes.generator)
    .addNode('evaluator', nodes.evaluator)
    .addNode('report', nodes.report)
    .addEdge(START, 'planner')
    .addEdge('planner', 'proposer')
    .addEdge('proposer', 'reviewer')
    .addConditionalEdges(
      'reviewer',
      (state) => (state.review_verdict === 'APPROVED' ? 'generator' : 'proposer'),
      { generator: 'generator', proposer: 'proposer' },
    )
    .addEdge('generator', 'evaluator')
    .addConditionalEdges(
      'evaluator',
      (state) => (state.evaluator_verdict === 'PASS' ? 'report' : 'generator'),
      { report: 'report', generator: 'generator' },
    )
    .addEdge('report', END);

  return graph;
}

/**
 * 编译 graph 为可调用 app。
 *
 * @param {object}  [opts]
 * @param {object}  [opts.overrides]    传给 buildHarnessGraph
 * @param {object}  [opts.checkpointer] BaseCheckpointSaver；不传则用 MemorySaver
 */
export function compileHarnessApp({ overrides, checkpointer } = {}) {
  const graph = buildHarnessGraph(overrides);
  const saver = checkpointer || new MemorySaver();
  return graph.compile({ checkpointer: saver });
}

// 节点名常量（runner / 测试 / observability 共用）
export const HARNESS_NODE_NAMES = ['planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'report'];
