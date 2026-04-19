/**
 * Content Pipeline LangGraph
 *
 * 仿 harness-graph.js，给 Content Pipeline（每天/手动生成一套内容）用。
 * 节点：research → copywrite → copy_review → generate → image_review → export
 * 条件边：
 *   - copy_review: APPROVED → generate, REVISION → copywrite（文案回路）
 *   - image_review: PASS → export, FAIL → generate（图片回路）
 *
 * 本 PR 只交付骨架：
 *   - state = Annotation.Root，字段全是"引用"（文件路径、verdict、反馈），
 *     不放节点产出的大段文本 → token 不累积
 *   - 节点默认 placeholder（return state），不跑 docker
 *   - CONTENT_PIPELINE_LANGGRAPH_ENABLED 开关控制启用（暂未接入 runner）
 *
 * PR-3 会把节点换成 createDockerNodes(executeInDocker)，真跑 Claude 子进程。
 *
 * 用法（PR-3 之后）：
 *   const nodes = createContentDockerNodes(executeInDocker, task);
 *   const app = compileContentPipelineApp({ overrides: nodes });
 *   for await (const ev of app.stream(initial, { configurable: { thread_id: pipelineId } })) { ... }
 */

import { StateGraph, START, END, Annotation, MemorySaver } from '@langchain/langgraph';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

// ─── Skill 内联加载 ──────────────────────────────────────────────────────────
// Docker 容器里 Claude Code headless (-p) 模式不识别 `/skill-name` 语法，
// 必须把 SKILL.md 原文内联到 prompt 里。
// 注：此段逻辑与 harness-graph.js 完全对等（复制而非 import，避免拖拽 harness
// 模块进 content-pipeline 测试文件的 v8 coverage 统计）。
const SKILL_SEARCH_DIRS = [
  path.join(os.homedir(), '.claude-account1', 'skills'),
  path.join(os.homedir(), '.claude-account2', 'skills'),
  path.join(os.homedir(), '.claude', 'skills'),
];

const _skillCache = new Map();

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

// ─── Docker 输出解析 ─────────────────────────────────────────────────────────

export function parseDockerOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return '';
  const trimmed = stdout.trim();
  if (!trimmed) return '';

  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.result) return typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result);
      if (obj.content) return typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
      return line;
    } catch {
      continue;
    }
  }
  return trimmed.slice(-4000);
}

export function extractField(text, fieldName) {
  if (!text) return null;
  const re = new RegExp(`(?:\\*\\*)?${fieldName}(?:\\*\\*)?:\\s*(.+?)(?:\\s+\\w+:|\\n|$)`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

export function extractVerdict(text, validValues) {
  if (!text) return null;
  const upper = text.toUpperCase();

  const verdictMatch = upper.match(/(?:VERDICT|裁决|REVIEW_VERDICT|EVALUATOR_VERDICT)\s*[:=]\s*([\w]+)/);
  if (verdictMatch) {
    const v = verdictMatch[1];
    if (validValues.includes(v)) return v;
  }

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
 * Content Pipeline 状态 schema
 *
 * 设计原则：只放引用（路径、verdict、反馈），不放节点产出的文本本体。
 * 大段文本（findings/copy/manifest 等）落文件系统，state 里只带路径。
 *
 * 字段：
 *  - pipeline_id              content_pipeline initiative 的 id（也用作 thread_id）
 *  - keyword                  原始关键词（或 LLM 扩展后的长查询）
 *  - output_dir               pipeline 产物根目录（日期-slug 全路径）
 *
 *  - findings_path            research 产出 findings.json 路径
 *  - copy_path                copywrite 产出 copy.md 路径
 *  - article_path             copywrite 产出 article.md 路径
 *  - person_data_path         generate 产出 person-data.json 路径
 *  - cards_dir                generate 产出的卡片目录（含 9 张 PNG）
 *  - manifest_path            export 产出 manifest.json 路径
 *
 *  - copy_review_verdict      'APPROVED' | 'REVISION'
 *  - copy_review_feedback     REVISION 时给下一轮 copywrite 的反馈（文字）
 *  - copy_review_round        文案回路计数
 *
 *  - image_review_verdict     'PASS' | 'FAIL'
 *  - image_review_feedback    FAIL 时给下一轮 generate 的反馈（文字）
 *  - image_review_round       图片回路计数
 *
 *  - nas_url                  export 完成后 NAS 上的 content 路径
 *
 *  - trace                    节点执行轨迹（reducer 累加，debug 用）
 *  - error                    节点失败时的错误信息
 */
export const ContentPipelineState = Annotation.Root({
  pipeline_id: Annotation,
  keyword: Annotation,
  output_dir: Annotation,

  findings_path: Annotation,
  copy_path: Annotation,
  article_path: Annotation,
  person_data_path: Annotation,
  cards_dir: Annotation,
  manifest_path: Annotation,

  copy_review_verdict: Annotation,
  copy_review_feedback: Annotation,
  copy_review_round: Annotation,

  image_review_verdict: Annotation,
  image_review_feedback: Annotation,
  image_review_round: Annotation,

  nas_url: Annotation,

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
 * Placeholder 节点工厂。
 * PR-1 骨架阶段用；PR-3 接入 docker 后替换。
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

/**
 * 构造 content pipeline graph（未编译）。
 *
 * 暴露未编译的 builder，让测试可以注入自定义节点覆盖条件边路径，
 * 不必真正调 Docker executor。
 *
 * @param {object} [overrides]  节点 override map: { research, copywrite, copy_review, generate, image_review, export }
 * @returns {StateGraph}        未编译的 StateGraph
 */
export function buildContentPipelineGraph(overrides = {}) {
  const nodes = {
    research:     overrides.research     || placeholderNode('research'),
    copywrite:    overrides.copywrite    || placeholderNode('copywrite'),
    copy_review:  overrides.copy_review  || placeholderNode('copy_review', () => ({ copy_review_verdict: 'APPROVED' })),
    generate:     overrides.generate     || placeholderNode('generate'),
    image_review: overrides.image_review || placeholderNode('image_review', () => ({ image_review_verdict: 'PASS' })),
    export:       overrides.export       || placeholderNode('export'),
  };

  const graph = new StateGraph(ContentPipelineState)
    .addNode('research', nodes.research)
    .addNode('copywrite', nodes.copywrite)
    .addNode('copy_review', nodes.copy_review)
    .addNode('generate', nodes.generate)
    .addNode('image_review', nodes.image_review)
    .addNode('export', nodes.export)
    .addEdge(START, 'research')
    .addEdge('research', 'copywrite')
    .addEdge('copywrite', 'copy_review')
    .addConditionalEdges(
      'copy_review',
      (state) => (state.copy_review_verdict === 'APPROVED' ? 'generate' : 'copywrite'),
      { generate: 'generate', copywrite: 'copywrite' },
    )
    .addEdge('generate', 'image_review')
    .addConditionalEdges(
      'image_review',
      (state) => (state.image_review_verdict === 'PASS' ? 'export' : 'generate'),
      { export: 'export', generate: 'generate' },
    )
    .addEdge('export', END);

  return graph;
}

/**
 * 编译 graph 为可调用 app。
 *
 * @param {object} [opts]
 * @param {object} [opts.overrides]    传给 buildContentPipelineGraph
 * @param {object} [opts.checkpointer] BaseCheckpointSaver；不传则用 MemorySaver
 */
export function compileContentPipelineApp({ overrides, checkpointer } = {}) {
  const graph = buildContentPipelineGraph(overrides);
  const saver = checkpointer || new MemorySaver();
  return graph.compile({ checkpointer: saver });
}

// 节点名常量（runner / 测试 / observability 共用）
export const CONTENT_PIPELINE_NODE_NAMES = [
  'research',
  'copywrite',
  'copy_review',
  'generate',
  'image_review',
  'export',
];

// ─── Docker 节点工厂 ─────────────────────────────────────────────────────────

/**
 * 节点配置：skill 名、task_type、产物字段提取规则、verdict 提取规则。
 */
const NODE_CONFIGS = {
  research: {
    skill: 'pipeline-research',
    task_type: 'content_research',
    outputs: ['findings_path', 'output_dir'],
  },
  copywrite: {
    skill: 'pipeline-copywrite',
    task_type: 'content_copywrite',
    outputs: ['copy_path', 'article_path'],
  },
  copy_review: {
    skill: 'pipeline-copy-review',
    task_type: 'content_copy_review',
    outputs: ['copy_review_feedback'],
    verdict_field: 'copy_review_verdict',
    verdict_values: ['APPROVED', 'REVISION'],
  },
  generate: {
    skill: 'pipeline-generate',
    task_type: 'content_generate',
    outputs: ['person_data_path', 'cards_dir'],
  },
  image_review: {
    skill: 'pipeline-review',
    task_type: 'content_image_review',
    outputs: ['image_review_feedback'],
    verdict_field: 'image_review_verdict',
    verdict_values: ['PASS', 'FAIL'],
  },
  export: {
    skill: 'pipeline-export',
    task_type: 'content_export',
    outputs: ['manifest_path', 'nas_url'],
  },
};

/**
 * 构建节点 prompt：skill content + input_ref 字段。
 *
 * 关键：不嵌前面节点的文本输出（copy.md / article.md / findings.json 内容），
 * 只传路径引用。节点自己在 docker 容器里 Read 文件。token 不累积。
 *
 * @param {string} nodeName     'research' | 'copywrite' | ...
 * @param {string} skillContent SKILL.md 原文
 * @param {object} state        当前 ContentPipelineState
 * @param {string} taskId       Brain task id
 * @returns {string}            完整 prompt
 */
export function buildNodeInputPrompt(nodeName, skillContent, state, taskId) {
  const cfg = NODE_CONFIGS[nodeName];
  const round =
    nodeName === 'copywrite' && state.copy_review_round
      ? `\n**copywrite_round**: ${state.copy_review_round + 1}`
      : nodeName === 'generate' && state.image_review_round
        ? `\n**generate_round**: ${state.image_review_round + 1}`
        : '';

  // Input refs（路径，非文本内容）
  const refs = [];
  if (state.pipeline_id) refs.push(`**pipeline_id**: ${state.pipeline_id}`);
  if (state.keyword) refs.push(`**keyword**: ${state.keyword}`);
  if (state.output_dir) refs.push(`**output_dir**: ${state.output_dir}`);
  if (state.findings_path && nodeName !== 'research') refs.push(`**findings_path**: ${state.findings_path}`);
  if (state.copy_path && (nodeName === 'copy_review' || nodeName === 'generate' || nodeName === 'export'))
    refs.push(`**copy_path**: ${state.copy_path}`);
  if (state.article_path && (nodeName === 'copy_review' || nodeName === 'export'))
    refs.push(`**article_path**: ${state.article_path}`);
  if (state.person_data_path && (nodeName === 'image_review' || nodeName === 'export'))
    refs.push(`**person_data_path**: ${state.person_data_path}`);
  if (state.cards_dir && (nodeName === 'image_review' || nodeName === 'export'))
    refs.push(`**cards_dir**: ${state.cards_dir}`);

  // Feedback（REVISION / FAIL 回路时传，非内容）
  const feedback =
    nodeName === 'copywrite' && state.copy_review_feedback
      ? `\n\n## 上一轮审查反馈\n${state.copy_review_feedback}`
      : nodeName === 'generate' && state.image_review_feedback
        ? `\n\n## 上一轮 vision 审查反馈\n${state.image_review_feedback}`
        : '';

  const outputContract = cfg.verdict_field
    ? `\n\n## 输出要求\n在 stdout 最后输出:\n\`\`\`\n${cfg.verdict_field}: ${cfg.verdict_values.join('|')}\n${cfg.outputs.map((f) => `${f}: <内容或 null>`).join('\n')}\n\`\`\``
    : `\n\n## 输出要求\n在 stdout 最后输出产物路径:\n\`\`\`\n${cfg.outputs.map((f) => `${f}: <绝对路径>`).join('\n')}\n\`\`\``;

  return `你是 ${cfg.skill} agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次节点参数
**task_id**: ${taskId}
**node**: ${nodeName}${round}
${refs.join('\n')}${feedback}${outputContract}`;
}

/**
 * 创建接入 Docker 的真实节点集合。
 *
 * @param {Function} dockerExecutor  executeInDocker 函数（仿 harness）
 * @param {Object}   task            Brain 任务对象（含 id, payload 等）
 * @param {Object}   [opts]
 * @param {Record<string,string>} [opts.env]  额外注入容器的环境变量
 * @returns {Object}                 节点 map: { research, copywrite, copy_review, generate, image_review, export }
 */
export function createContentDockerNodes(dockerExecutor, task, opts = {}) {
  const baseEnv = opts.env || {};
  const taskId = task.id;

  /**
   * 通用 Docker 节点执行器。
   * 构建 prompt → 调 executeInDocker → 解析输出 → 返回 state 更新。
   */
  async function runDockerNode(nodeName, state) {
    const cfg = NODE_CONFIGS[nodeName];
    console.log(`[content-pipeline-graph] node=${nodeName} task=${taskId} starting docker execution`);
    const startMs = Date.now();

    const skillContent = loadSkillContent(cfg.skill);
    const prompt = buildNodeInputPrompt(nodeName, skillContent, state, taskId);

    try {
      const result = await dockerExecutor({
        task: { ...task, task_type: cfg.task_type },
        prompt,
        env: {
          ...baseEnv,
          CECELIA_TASK_TYPE: cfg.task_type,
          CONTENT_PIPELINE_NODE: nodeName,
          CONTENT_PIPELINE_ID: state.pipeline_id || '',
          CONTENT_OUTPUT_DIR: state.output_dir || '',
        },
      });

      const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
      const success = result.exit_code === 0 && !result.timed_out;
      console.log(
        `[content-pipeline-graph] node=${nodeName} task=${taskId} exit=${result.exit_code} timed_out=${result.timed_out} duration=${durationSec}s`
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
      console.error(`[content-pipeline-graph] node=${nodeName} task=${taskId} error: ${err.message}`);
      return { output: '', error: err.message, success: false };
    }
  }

  /**
   * 从 stdout 提取节点声明的 output 字段，合并到 state 更新。
   */
  function extractNodeOutputs(nodeName, output, state) {
    const cfg = NODE_CONFIGS[nodeName];
    const update = { trace: nodeName };

    for (const field of cfg.outputs) {
      const v = extractField(output, field);
      if (v) update[field] = v;
    }

    if (cfg.verdict_field) {
      const v = extractVerdict(output, cfg.verdict_values) || cfg.verdict_values[0];
      update[cfg.verdict_field] = v;
      // round 累加（graph 外部 reducer 无，这里手动）
      if (nodeName === 'copy_review') {
        update.copy_review_round = (state.copy_review_round || 0) + 1;
      } else if (nodeName === 'image_review') {
        update.image_review_round = (state.image_review_round || 0) + 1;
      }
    }

    return update;
  }

  const makeNode = (nodeName) => async (state) => {
    const { output, error, success } = await runDockerNode(nodeName, state);
    if (!success) {
      return { error, trace: `${nodeName}(ERROR)` };
    }
    return { ...extractNodeOutputs(nodeName, output, state), error: null };
  };

  return {
    research:     makeNode('research'),
    copywrite:    makeNode('copywrite'),
    copy_review:  makeNode('copy_review'),
    generate:     makeNode('generate'),
    image_review: makeNode('image_review'),
    export:       makeNode('export'),
  };
}

// 导出给测试用
export { NODE_CONFIGS };
