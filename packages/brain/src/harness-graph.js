/**
 * Harness LangGraph — Docker-backed pipeline
 *
 * 替代 routes/execution.js + harness-watcher.js 中手写的 6 阶段状态机。
 *
 * Harness v2 M4（2026-04-20）节点：
 *   planner → proposer ↔ reviewer → generator → ci_gate → evaluator → report
 *
 * 条件边：
 *   - reviewer:   APPROVED → generator, REVISION → proposer（GAN 循环，无上限）
 *   - ci_gate:    PASS → evaluator, FAIL/TIMEOUT → generator（同分支 Fix commit）
 *   - evaluator:  PASS → report,   FAIL → generator（Task 级 Fix 循环，无上限）
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
import { pollPRChecks } from './harness-ci-gate.js';

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
 * Harness v2 M4（2026-04-20）：Task 级循环 + Generator Fix 同分支 commit + CI Gate + Evaluator 去 E2E。
 * 弃用 v1 多 Workstream 模型的 state 字段（workstreams/pr_urls/pr_branches/ws_verdicts/ws_feedbacks）。
 * parseWorkstreams 保留作 legacy fallback，但主流程走 M3 parseTasks。
 *
 * 模型：1 Task = 1 PR = 1 分支；Fix 循环在同分支多 commit，绝不开新 PR。
 *
 * 字段说明（全部可选）：
 *  - task_id              关联的 Brain 任务 ID（也用作 langgraph thread_id）
 *  - task_description     原始用户需求
 *  - sprint_dir           sprints/ 目录
 *  - prd_content          Layer 1 planner 输出
 *  - contract_content     Layer 2a proposer 输出
 *  - review_verdict       Layer 2b reviewer 裁决：'APPROVED' | 'REVISION'
 *  - review_feedback      reviewer REVISION 时的反馈内容
 *  - review_round         review 回合计数
 *  - acceptance_criteria  proposer 输出的 Given-When-Then 验收标准
 *  - tasks                M3 proposer 解析的 Task 列表（来自 ## Tasks）
 *  - pr_url               当前 Task 的 PR URL（单值，非数组）
 *  - pr_branch            当前 Task 的 PR 分支名
 *  - commit_shas          Fix 模式累积的 commit SHA 数组
 *  - ci_status            M4 CI Gate 状态：'pass' | 'fail' | 'timeout' | 'pending'
 *  - ci_failed_check      CI FAIL 时的失败 check 名
 *  - ci_feedback          CI FAIL 时的 log 片段（注入下轮 Generator Fix prompt）
 *  - evaluator_verdict    Evaluator Task 级裁决：'PASS' | 'FAIL'
 *  - eval_feedback        Evaluator FAIL 时的反馈（注入下轮 Generator Fix prompt）
 *  - eval_round           Generator 进入次数（0 = 首次，>0 = Fix 模式）
 *  - report_path          Layer 4 report 输出
 *  - trace                节点执行轨迹（debug 用，reducer 累加）
 *  - error                错误信息（节点失败时写入）
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
  // ── M3 新字段（parseTasks 解析结果）────────────────────────────────────────
  tasks: Annotation,
  // ── M4 Task 级循环字段（单 Task = 单 PR = 单分支）─────────────────────────
  pr_url: Annotation,
  pr_branch: Annotation,
  commit_shas: Annotation,
  ci_status: Annotation,
  ci_failed_check: Annotation,
  ci_feedback: Annotation,
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
 * 被视为"未提供"的字面量（Claude 在失败/缺值时可能输出这些）。
 * extractField 抓到这些字符串时返回 null，下游才不会把假值当真。
 *
 * 背景：harness task 0154e285 在 Generator 里 git push 静默失败（容器 .gitconfig
 * :ro 挂载导致 safe.directory 设置失败），Claude 输出 `pr_url: null`，老正则
 * 贪婪匹配返回字符串 "null"，Evaluator 拿到这个"URL" 必然 FAIL，Fix 循环无限死循环。
 */
const INVALID_LITERALS = new Set([
  'null', 'undefined', 'none', 'n/a', 'na',
  'failed', 'error', 'tbd', 'todo',
  '<url>', '<pr_url>', '<branch>', '<pr_branch>',
]);

/**
 * 从 Docker 输出中提取特定字段值。
 *
 * 策略（按优先级）：
 *   1. 字面量匹配 `field: value` / `**field**: value` / JSON `"field": "value"`
 *      - 值命中 INVALID_LITERALS（null/FAILED/none/...）→ 视为无提取
 *      - 值两端引号 → 剥掉
 *   2. pr_url 额外 fallback：扫全文找 `https://github.com/{owner}/{repo}/pull/{num}`
 *   3. pr_branch 额外 fallback：扫全文找 `cp-\d{8,10}-[\w-]+` 分支名
 *   4. 否则返回 null
 *
 * SKILL.md 要求 Claude 输出纯 JSON `{"verdict":"DONE","pr_url":"..."}`；
 * harness-graph.js prompt 要求 `pr_url: <URL>` 字面量。两种格式经过上面
 * 三步策略都能被正确提取。
 */
export function extractField(text, fieldName) {
  if (!text) return null;
  const fieldLower = String(fieldName).toLowerCase();

  // Step 1: 字面量匹配
  // 允许 key 被 `**` 或 `"` 包裹（markdown 粗体 / JSON 场景）
  // 值首字符允许可选 `"`，然后非引号/非换行/非逗号/非右花括号的字符
  // 尾端可选 `"`，前瞻 `,` `}` `\n` `EOF`
  const re = new RegExp(
    `(?:\\*\\*|")?${fieldName}(?:\\*\\*|")?\\s*:\\s*"?([^"\\n,}]*?)"?(?=\\s*(?:[,}]|\\n|$))`,
    'i'
  );
  const m = text.match(re);
  if (m && m[1] !== undefined) {
    const candidate = m[1].trim();
    if (candidate && !INVALID_LITERALS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // Step 2: pr_url fallback — 扫裸 GitHub PR URL
  // 兼容 markdown 链接 / gh pr create 默认输出 / JSON 里被引号包的 URL
  if (fieldLower === 'pr_url') {
    const urlMatch = text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
    if (urlMatch) return urlMatch[0];
  }

  // Step 3: pr_branch fallback — 扫 cp- 分支名
  // cp-<8-10 digits>-<word-chars and hyphens>
  if (fieldLower === 'pr_branch') {
    const branchMatch = text.match(/\bcp-\d{8,10}-[\w-]+/);
    if (branchMatch) return branchMatch[0];
  }

  return null;
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

/**
 * 从合同正文中解析 `## Tasks` 区块（Harness v2 M3 新格式）。
 *
 * 每个 Task 子块结构：
 *   ### Task: <task_id>
 *   **title**: ...
 *   **scope**: ...
 *   **depends_on**: [id1, id2]
 *   **files**: [path1, path2]
 *
 *   #### DoD
 *   - [ARTIFACT] ...
 *   - [BEHAVIOR] ...
 *
 *   #### Unit Test Plan（强制测试金字塔）
 *   - 覆盖点 1: ...
 *
 *   #### Integration Test Plan（强制）
 *   - 场景 1: ...
 *
 *   #### 验证命令
 *   - manual:node -e "..."
 *
 * 返回数组；每项
 *   `{ task_id, title, scope, depends_on[], files[], dod, unit_test_plan,
 *      integration_test_plan, verify_commands }`。
 *
 * 若合同没有 `## Tasks` 区块或区块为空，返回空数组。调用方应 fallback 到
 * `parseWorkstreams` 以兼容 v1 老合同。
 *
 * @param {string} contract  合同 markdown 原文
 * @returns {Array<{task_id:string, title:string, scope:string, depends_on:string[], files:string[], dod:string, unit_test_plan:string, integration_test_plan:string, verify_commands:string}>}
 */
export function parseTasks(contract) {
  if (!contract || typeof contract !== 'string') return [];

  // 找到 ## Tasks 标题（兼容中文"任务列表"）
  const headRe = /^##\s+(?:Tasks|tasks|TASKS|任务列表)\s*$/im;
  const headMatch = contract.match(headRe);
  if (!headMatch) return [];

  const startIdx = headMatch.index + headMatch[0].length;
  const rest = contract.slice(startIdx);
  // 下一个同级 `## ` 或 EOF（允许 `### Task:` 子块）
  const nextHead = rest.match(/\n##\s+(?!#)\S/);
  const section = nextHead ? rest.slice(0, nextHead.index) : rest;

  // 按 `### Task:` 切块
  const taskBlockRe =
    /###\s+Task\s*[:：]\s*([^\n]+)\n([\s\S]*?)(?=\n###\s+Task\s*[:：]|\n##\s+\S|$)/gi;
  const tasks = [];
  let m;
  while ((m = taskBlockRe.exec(section)) !== null) {
    const taskId = (m[1] || '').trim();
    const body = m[2] || '';
    if (!taskId) continue;

    const title = extractBoldField(body, 'title');
    const scope = extractBoldField(body, 'scope');
    const depsRaw = extractBoldField(body, 'depends_on') || '[]';
    const filesRaw = extractBoldField(body, 'files') || '[]';

    const dod = extractSubSection(body, 'DoD');
    const unit = extractSubSection(body, 'Unit Test Plan');
    const integ = extractSubSection(body, 'Integration Test Plan');
    const verify =
      extractSubSection(body, '验证命令') ||
      extractSubSection(body, 'Verify Commands');

    tasks.push({
      task_id: taskId,
      title: title || '',
      scope: scope || '',
      depends_on: parseListField(depsRaw),
      files: parseListField(filesRaw),
      dod: dod || '',
      unit_test_plan: unit || '',
      integration_test_plan: integ || '',
      verify_commands: verify || '',
    });
  }

  return tasks;
}

/**
 * 从 Task 子块正文里抓 `**field**: value` 到行尾。
 * @private
 */
function extractBoldField(body, field) {
  const re = new RegExp(`\\*\\*${field}\\*\\*\\s*[:：]\\s*([^\\n]*)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : '';
}

/**
 * 从 Task 子块正文里抓 `#### <name>` 到下一个 `#### ` 或块结束之间的内容。
 * name 允许带括号后缀（如 "Unit Test Plan（强制测试金字塔）"）。
 * @private
 */
function extractSubSection(body, name) {
  const re = new RegExp(
    `####\\s+${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n####\\s+|$)`,
    'i'
  );
  const m = body.match(re);
  return m ? m[1].trim() : '';
}

/**
 * 解析类似 `[id1, id2]` 或 `id1, id2` 的列表字段。空/空括号返回 []。
 * @private
 */
function parseListField(raw) {
  if (!raw) return [];
  const inner = raw.replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
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

    // Harness v2 M4：主流程用 M3 parseTasks（## Tasks 格式）
    // parseWorkstreams 保留作 legacy fallback（兼容 v1 老合同）
    const tasks = parseTasks(output || '');
    let legacyWs = null;
    if (tasks.length === 0) {
      legacyWs = parseWorkstreams(output || '');
      console.log(
        `[harness-graph] proposer legacy Workstreams count=${legacyWs.length} task=${taskId}: ${legacyWs.map(w => `WS${w.index}(${w.name})`).join(', ')}`
      );
    } else {
      console.log(
        `[harness-graph] proposer parsed Tasks(v2) count=${tasks.length} task=${taskId}: ${tasks.map(t => t.task_id).join(', ')}`
      );
    }

    return {
      contract_content: output || null,
      acceptance_criteria: acceptanceCriteria,
      tasks,  // Harness v2 M3 新字段（M4 主流程）
      review_round: round,
      error: error || null,
      trace: `proposer(R${round},${tasks.length > 0 ? `tasks=${tasks.length}` : `ws=${legacyWs ? legacyWs.length : 0}`})${error ? '(ERROR)' : ''}`,
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

## 审查要求（Harness v2 M3 — skeptical tuning）

你的工作是**找风险**，不是认可合同。以下 3 个维度**每轮必须都真实挑战过**：

1. **DAG 合理性**：Task 间的 depends_on 是否有隐藏耦合？是否可以更细粒度拆？是否有循环依赖？
2. **Initiative 级 E2E 覆盖**：合同 ## E2E Acceptance 是否覆盖跨 Task 行为？Given-When-Then 关键分支/异常是否完整？
3. **测试金字塔完整性**：每 Task 是否同时有 Unit Test Plan 和 Integration Test Plan？缺就 REVISION。

此外保持 v1 已有挑战：验证命令严格性、命令广谱（curl/playwright/psql/node -e）、DoD 格式（[ARTIFACT]/[BEHAVIOR] + Test）。

## 裁决规则（硬约束）

- **每一轮必须列出 ≥2 个具体风险点**（at least 2 concrete risks，覆盖上述 3 维度任意组合）。
- **找不到 ≥2 个具体风险点不允许 APPROVED**，至少输出 2 条挑战建议走 REVISION。
- **APPROVED 唯一条件**：3 维度都真实挑战过且真的找不到新风险。
- 输出裁决：VERDICT: APPROVED 或 VERDICT: REVISION
- REVISION 时必须给出具体修改建议。`;

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

  // ── Generator 节点（Harness v2 M4：单 Task 单 PR + 两模式）──────────────
  //
  // 模式分流（硬约束）：
  //   - isFixMode = (state.eval_round || 0) > 0
  //   - 新建 PR 模式（eval_round == 0）：checkout 新分支 → push → gh pr create → 输出 pr_url
  //   - Fix 模式（eval_round > 0）：checkout 同一个 state.pr_branch → commit → push → 输出 commit_sha
  //
  // 撤销 #2420 方向：不再按 Workstream 循环产多 PR；一次调用产/改一个 PR。
  const generator = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const evalRound = state.eval_round || 0;
    const isFixMode = evalRound > 0;

    // Fix 模式反馈来源：CI gate 反馈优先（CI 先跑），Evaluator 反馈次之
    const ciFeedback = state.ci_feedback ? String(state.ci_feedback) : '';
    const evalFeedback = state.eval_feedback ? String(state.eval_feedback) : '';
    const feedbackBlock = isFixMode
      ? [
          ciFeedback ? `## CI 失败片段（Round ${evalRound}）\n${ciFeedback}` : '',
          evalFeedback ? `## Evaluator 反馈（Round ${evalRound}）\n${evalFeedback}` : '',
        ].filter(Boolean).join('\n\n')
      : '';

    // 已存在的 PR 信息（Fix 模式必须复用同分支）
    const existingPrUrl = state.pr_url || '';
    const existingPrBranch = state.pr_branch || '';

    console.log(
      `[harness-graph] generator starting task=${taskId} mode=${isFixMode ? 'fix' : 'new'} ` +
      `eval_round=${evalRound} pr_url=${existingPrUrl || 'none'} pr_branch=${existingPrBranch || 'none'}`
    );

    const skillContent = loadSkillContent('harness-generator');

    // 两模式 prompt — 明确分流，硬约束"Fix 模式永远不要开新 PR"
    const modeSection = isFixMode
      ? `## 模式：Fix 模式（eval_round=${evalRound}，同分支累积 commit）

**硬约束：永远不要在 Fix 模式开新 PR；同分支累积 commit。**

已有 PR：${existingPrUrl}
已有分支：${existingPrBranch}

必做步骤：
1. \`gh pr checkout ${existingPrBranch || '<pr_branch>'}\` 或 \`git fetch origin && git checkout ${existingPrBranch || '<pr_branch>'} && git pull\`
2. 根据下面的 CI / Evaluator 反馈定位问题并修代码
3. \`git add <文件> && git commit -m "fix(harness): ..." && git push origin HEAD\`
4. **不要** 跑 \`gh pr create\`（PR 号已存在）
5. 输出 \`commit_sha: <新 commit SHA>\` 和 \`pr_url: ${existingPrUrl}\`（保持原值）

${feedbackBlock}`
      : `## 模式：新建 PR 模式（eval_round=0，首次实现）

必做步骤：
1. \`git checkout -b cp-$(date +%m%d%H%M)-<task-slug>\`
2. 严格按下面合同的当前 Task 范围实现，不越界
3. \`git add <文件> && git commit -m "feat(harness): ..." && git push -u origin HEAD\`
4. \`gh pr create --title "..." --body "..."\` 产生 PR URL
5. 输出 \`pr_url: <URL>\` 和 \`pr_branch: <分支名>\``;

    const prompt = `你是 harness-generator agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**task_type**: ${isFixMode ? 'harness_fix' : 'harness_generate'}
**eval_round**: ${evalRound}
**is_fix_mode**: ${isFixMode}

${modeSection}

## PRD 内容
${state.prd_content || '（PRD 未生成）'}

## 合同内容（GAN 已批准）
${state.contract_content || '（合同未生成）'}

## 验收标准（Given-When-Then）
${state.acceptance_criteria || '（验收标准未生成）'}

## 输出格式（严格遵守 — Brain 依此提取）

${isFixMode
  ? `Fix 模式成功路径：
\`\`\`
pr_url: ${existingPrUrl || '<保持上轮值>'}
pr_branch: ${existingPrBranch || '<保持上轮值>'}
commit_sha: <新 commit SHA>
\`\`\`

或 JSON：\`{"verdict": "FIXED", "pr_url": "${existingPrUrl}", "commit_sha": "..."}\`

失败路径：
\`\`\`
pr_url: ${existingPrUrl || 'FAILED'}
commit_sha: FAILED
STEP <N> FAILED: <具体错误>
\`\`\``
  : `新建 PR 模式成功路径：
\`\`\`
pr_url: https://github.com/perfectuser21/cecelia/pull/<编号>
pr_branch: cp-<时间戳>-<task-slug>
\`\`\`

或 JSON：\`{"verdict": "DONE", "pr_url": "..."}\`

失败路径：
\`\`\`
pr_url: FAILED
pr_branch: FAILED
STEP <N> FAILED: <具体错误>
\`\`\``
}

禁止事项：
- 禁止输出 \`pr_url: null\`（用 FAILED 代替）
- ${isFixMode ? '禁止在 Fix 模式跑 `gh pr create`（同分支 commit 累积，PR 号不变）' : '禁止在新建模式 checkout 已有分支'}
- 禁止隐藏失败（push 失败必须明确输出 FAILED + 原因）`;

    const { output, error } = await runDockerNode(
      'generator',
      isFixMode ? 'harness_fix' : 'harness_generate',
      prompt,
      state,
    );

    // 解析产出
    const parsedPrUrl = extractField(output, 'pr_url');
    const parsedPrBranch = extractField(output, 'pr_branch');
    const parsedCommitSha = extractField(output, 'commit_sha');

    // Fix 模式：pr_url / pr_branch 保持原值（忽略解析值，即便 LLM 输出了什么也不允许换 PR）
    const nextPrUrl = isFixMode ? (existingPrUrl || parsedPrUrl || null) : (parsedPrUrl || null);
    const nextPrBranch = isFixMode ? (existingPrBranch || parsedPrBranch || null) : (parsedPrBranch || null);

    // Fix 模式累积 commit_shas
    const nextCommitShas = isFixMode && parsedCommitSha
      ? [...(Array.isArray(state.commit_shas) ? state.commit_shas : []), parsedCommitSha]
      : (state.commit_shas || []);

    console.log(
      `[harness-graph] generator task=${taskId} done mode=${isFixMode ? 'fix' : 'new'} ` +
      `pr=${nextPrUrl || 'none'} branch=${nextPrBranch || 'none'} commit=${parsedCommitSha || 'none'}${error ? ' error=' + error.slice(0, 80) : ''}`
    );

    return {
      pr_url: nextPrUrl,
      pr_branch: nextPrBranch,
      commit_shas: nextCommitShas,
      // 进入 Generator 后清除上轮 CI / Evaluator 反馈（重新走完 ci_gate → evaluator）
      ci_status: null,
      ci_feedback: null,
      ci_failed_check: null,
      error: error || null,
      trace: `generator(${isFixMode ? 'fix-R' + evalRound : 'new'}${parsedCommitSha ? ',commit=' + parsedCommitSha.slice(0, 7) : ''})${error ? '(ERROR)' : ''}`,
    };
  };

  // ── Evaluator 节点（Harness v2 M4：Task 级对抗 QA，不跑真实 E2E）─────────
  //
  // 与 v1 的差异：
  //   - 删除 Workstream 循环，单次验收一个 Task 的 PR
  //   - 禁止启动 Brain 5222 / 真实前端 / 真实 PG（那是阶段 C 的事，M5 做）
  //   - 改为跑 unit test / integration test (mock deps) / 深度对抗 case
  //   - 停止条件：无上限 / 无软上限 / 不因"连续 N 轮无新 FAIL"终止
  const evaluator = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const round = (state.eval_round || 0) + 1;
    const prUrl = state.pr_url || null;
    const prBranch = state.pr_branch || null;

    console.log(
      `[harness-graph] evaluator starting task=${taskId} round=${round} pr_url=${prUrl || 'none'}`
    );

    // 没 PR 直接 FAIL — 回 generator 继续 commit（由外层图路由）
    if (!prUrl) {
      console.log(`[harness-graph] evaluator task=${taskId} FAIL (no PR)`);
      return {
        evaluator_verdict: 'FAIL',
        eval_round: round,
        eval_feedback: 'Generator 未产出 PR（pr_url 缺失）',
        error: null,
        trace: `evaluator(R${round}:FAIL,no-pr)`,
      };
    }

    const skillContent = loadSkillContent('harness-evaluator');
    const prompt = `你是 harness-evaluator agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**pr_url**: ${prUrl}
**pr_branch**: ${prBranch || ''}
**eval_round**: ${round}

## 验收范围（Harness v2 M4 — Task 级对抗 QA）

你只负责对这一个 PR 做 **Task 级对抗 QA**：
- **跑 unit test**（针对改动文件的单元测试）
- **跑 integration test**（mock deps，in-memory）
- **深度对抗**：空输入 / null / undefined / 超长字符串 / emoji / 不存在 ID / 已删除 ID / 权限不符 ID / 并发 Promise.all / 错误路径 / race condition

**禁止做的事**（这是阶段 C 的职责，M5 会做）：
- 禁止启动 Brain 5222
- 禁止启动真实前端
- 禁止启动真实 PostgreSQL
- 禁止跑 Initiative 级端到端验收

## 合同内容
${state.contract_content || '（合同未生成）'}

## 验收标准（Given-When-Then）
${state.acceptance_criteria || '（验收标准未生成）'}

## 停止条件（硬约束）

**无上限 / 无软上限 / 不因"连续 N 轮无新 FAIL"终止。**
PASS 的唯一条件 = 所有验收标准全部通过 + 每条对抗 case 明确测过。
对抗越多越好，越测越深。

## 输出

写入 ${sprintDir}/eval-task-${taskId}-round-${round}.md（记录测过的对抗 case + 失败证据）。
最后输出裁决：\`VERDICT: PASS\` 或 \`VERDICT: FAIL\``;

    const { output, error } = await runDockerNode('evaluator', 'harness_evaluate', prompt, state);

    const verdict = error
      ? 'FAIL'
      : (extractVerdict(output, ['PASS', 'FAIL']) || 'FAIL');
    const feedback = verdict === 'FAIL' ? (output || error || '') : null;

    console.log(`[harness-graph] evaluator task=${taskId} round=${round} verdict=${verdict}`);

    return {
      evaluator_verdict: verdict,
      eval_round: round,
      eval_feedback: feedback,
      error: error || null,
      trace: `evaluator(R${round}:${verdict})${error ? '(ERROR)' : ''}`,
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

  // ── CI Gate 节点（Harness v2 M4：非 LLM，纯 gh CLI 轮询）──────────────────
  // 注意：createDockerNodes 返回 ci_gate 使用默认 pollPRChecks；
  // 测试或特殊场景可用 createCiGateNode(customPollFn) 替换。
  const ci_gate = createCiGateNode(pollPRChecks);

  return { planner, proposer, reviewer, generator, ci_gate, evaluator, report };
}

/**
 * CI Gate 节点 factory（Harness v2 M4）。
 *
 * 接收一个 pollFn（默认 pollPRChecks）；返回符合 LangGraph 节点签名的 async 函数：
 *   - 读 state.pr_url → pollFn(url) → 返回 state update
 *   - PASS → ci_status='pass'
 *   - FAIL → ci_status='fail'，填 ci_feedback / ci_failed_check，eval_round += 1
 *   - TIMEOUT → ci_status='timeout'，eval_round += 1
 *   - pr_url 缺失 → ci_status='fail'，不调 pollFn
 *
 * 测试可注入 mock pollFn 直接返回固定结果。
 *
 * @param {Function} pollFn   async (prUrl, opts) => { status, ... }
 * @returns {(state) => Promise<object>}
 */
export function createCiGateNode(pollFn) {
  return async (state) => {
    const prUrl = state.pr_url || '';
    if (!prUrl || typeof prUrl !== 'string') {
      return {
        ci_status: 'fail',
        ci_feedback: 'ci_gate: pr_url 缺失',
        ci_failed_check: null,
        eval_round: (state.eval_round || 0) + 1,
        trace: 'ci_gate(fail:no-pr)',
      };
    }

    let result;
    try {
      result = await pollFn(prUrl);
    } catch (err) {
      return {
        ci_status: 'fail',
        ci_feedback: `ci_gate: pollPRChecks 抛错 — ${err.message}`,
        ci_failed_check: null,
        eval_round: (state.eval_round || 0) + 1,
        trace: 'ci_gate(fail:exception)',
      };
    }

    const status = String(result.status || '').toUpperCase();
    if (status === 'PASS') {
      return {
        ci_status: 'pass',
        ci_feedback: null,
        ci_failed_check: null,
        trace: 'ci_gate(pass)',
      };
    }
    if (status === 'TIMEOUT') {
      return {
        ci_status: 'timeout',
        ci_feedback: 'ci_gate: 30min TIMEOUT — CI 未在窗口内完成',
        ci_failed_check: null,
        eval_round: (state.eval_round || 0) + 1,
        trace: 'ci_gate(timeout)',
      };
    }
    // FAIL
    const failed = result.failedCheck || null;
    const feedback = [
      result.logSnippet ? `## 失败日志片段\n${result.logSnippet}` : '',
      failed ? `## 失败 check\n${failed.name || '(unknown)'} @ ${failed.link || '(no link)'}` : '',
    ].filter(Boolean).join('\n\n') || 'ci_gate: FAIL（无详细信息）';
    return {
      ci_status: 'fail',
      ci_feedback: feedback,
      ci_failed_check: failed ? (failed.name || null) : null,
      eval_round: (state.eval_round || 0) + 1,
      trace: `ci_gate(fail:${failed ? failed.name : 'unknown'})`,
    };
  };
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
    // M4 ci_gate 默认 placeholder 直接 PASS（测试不调真 gh CLI）
    ci_gate: overrides.ci_gate || placeholderNode('ci_gate', () => ({ ci_status: 'pass' })),
    evaluator: overrides.evaluator || placeholderNode('evaluator', () => ({ evaluator_verdict: 'PASS' })),
    report: overrides.report || placeholderNode('report'),
  };

  const graph = new StateGraph(HarnessState)
    .addNode('planner', nodes.planner)
    .addNode('proposer', nodes.proposer)
    .addNode('reviewer', nodes.reviewer)
    .addNode('generator', nodes.generator)
    .addNode('ci_gate', nodes.ci_gate)
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
    // Generator → CI Gate（M4 插入）
    .addEdge('generator', 'ci_gate')
    // CI Gate 路由：PASS → evaluator；FAIL/TIMEOUT → 回 generator 继续 Fix commit
    .addConditionalEdges(
      'ci_gate',
      (state) => (state.ci_status === 'pass' ? 'evaluator' : 'generator'),
      { evaluator: 'evaluator', generator: 'generator' },
    )
    // Evaluator 路由：PASS → report；FAIL → 回 generator（同分支 commit Fix）
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
// Harness v2 M4：ci_gate 插在 generator 和 evaluator 之间
export const HARNESS_NODE_NAMES = ['planner', 'proposer', 'reviewer', 'generator', 'ci_gate', 'evaluator', 'report'];
