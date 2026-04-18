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
 *  - pr_url            Layer 3 generator 输出
 *  - pr_branch         Layer 3 generator push 的分支名
 *  - evaluator_verdict Layer 3c evaluator 裁决：'PASS' | 'FAIL'
 *  - eval_feedback     evaluator FAIL 时的反馈内容
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

    return {
      contract_content: output || null,
      acceptance_criteria: acceptanceCriteria,
      review_round: round,
      error: error || null,
      trace: `proposer(R${round})${error ? '(ERROR)' : ''}`,
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

  // ── Generator 节点 ────────────────────────────────────────────────────────
  const generator = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const evalRound = state.eval_round || 0;
    const isFixMode = evalRound > 0;
    const evalFeedback = isFixMode && state.eval_feedback
      ? `\n\n## Evaluator 反馈（Round ${evalRound}）\n${state.eval_feedback}`
      : '';

    const skillContent = loadSkillContent('harness-generator');
    const prompt = `你是 harness-generator agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**task_type**: ${isFixMode ? 'harness_fix' : 'harness_generate'}
${isFixMode ? `**eval_round**: ${evalRound}\n**读取 eval-round-${evalRound}.md 中的 FAIL 反馈进行修复**` : ''}

## PRD 内容
${state.prd_content || '（PRD 未生成）'}

## 合同内容（GAN 已批准）
${state.contract_content || '（合同未生成）'}

## 验收标准（Given-When-Then）
${state.acceptance_criteria || '（验收标准未生成）'}
${evalFeedback}

## 执行要求
1. 严格按合同实现，不越界
2. 代码写完后 push PR
3. 在 stdout 输出 pr_url: <URL> 和 pr_branch: <branch>`;

    const { output, error } = await runDockerNode(
      'generator',
      isFixMode ? 'harness_fix' : 'harness_generate',
      prompt,
      state,
    );

    const prUrl = extractField(output, 'pr_url') || state.pr_url || null;
    const prBranch = extractField(output, 'pr_branch') || state.pr_branch || null;

    return {
      pr_url: prUrl,
      pr_branch: prBranch,
      error: error || null,
      trace: `generator(${isFixMode ? 'fix-R' + evalRound : 'gen'})${error ? '(ERROR)' : ''}`,
    };
  };

  // ── Evaluator 节点 ────────────────────────────────────────────────────────
  const evaluator = async (state) => {
    const sprintDir = state.sprint_dir || 'sprints';
    const round = (state.eval_round || 0) + 1;

    const skillContent = loadSkillContent('harness-evaluator');
    const prompt = `你是 harness-evaluator agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**pr_url**: ${state.pr_url || ''}
**pr_branch**: ${state.pr_branch || ''}
**eval_round**: ${round}

## 合同内容
${state.contract_content || '（合同未生成）'}

## 验收标准（Given-When-Then）
${state.acceptance_criteria || '（验收标准未生成）'}

## 目标
部署服务（重启 Brain / Dashboard），然后对照合同验收标准（Given-When-Then）进行 E2E 功能验收。
用 curl 验证 API，用 Playwright/浏览器验证前端。你的工作是找到失败，不是确认成功。
写入 ${sprintDir}/eval-round-${round}.md。
输出裁决：VERDICT: PASS 或 VERDICT: FAIL`;

    const { output, error } = await runDockerNode('evaluator', 'harness_evaluate', prompt, state);

    const verdict = error
      ? 'FAIL'  // Docker 失败时视为验收未通过
      : (extractVerdict(output, ['PASS', 'FAIL']) || 'PASS');
    const feedback = verdict === 'FAIL' ? (output || error || '') : null;

    console.log(`[harness-graph] evaluator verdict=${verdict} round=${round} task=${taskId}`);

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
