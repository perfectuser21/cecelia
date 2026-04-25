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

import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';

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

/**
 * 从 stdout 最后一行的 JSON 对象里抽字段（支持数组/对象/任意 JSON 值）。
 * skill 约定最后一行是 JSON（见 SOP），用于提取 rule_details 这类结构化字段。
 * 失败或无此字段返回 null。
 */
export function extractJsonField(text, fieldName) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && Object.prototype.hasOwnProperty.call(obj, fieldName)) {
        return obj[fieldName];
      }
    } catch {
      // not JSON, try prev line
    }
  }
  return null;
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
  copy_review_rule_details: Annotation,
  // LLM 5 维评审总分（0-25），由 skill 的 bash 逻辑聚合 5 维分值后输出。
  // 顶级字段让前端详情页直接读 event.payload.copy_review_total，无需再去
  // rule_details 数组里翻。null 表示该轮未评（例如 bash 硬规则就挂了）。
  copy_review_total: Annotation,

  image_review_verdict: Annotation,
  image_review_feedback: Annotation,
  image_review_round: Annotation,
  image_review_rule_details: Annotation,
  // vision 4 维评审平均分（0-20）。同理让前端直接读，不用翻 rule_details。
  // skill 在 stdout JSON 里输出字段名 "vision_avg"，这里 state 字段名也对齐成
  // image_review_vision_avg（顶级字段语义更清晰）。从 vision_avg 映射到
  // image_review_vision_avg 的逻辑在 extractNodeOutputs 里做。
  image_review_vision_avg: Annotation,

  nas_url: Annotation,

  // ─── WF-3 观察性字段（瞬态，每节点覆盖，不累积） ───────────────
  // 每个节点跑完后这些字段反映该节点的 Docker 执行元数据；
  // 下一个节点启动前会被覆盖（LangGraph 默认 reducer 就是 overwrite）。
  // runner 的 onStep 从 event[nodeName] 读这些字段，写进 cecelia_events.payload，
  // 供前端详情页展示"Brain 发给 Claude 的 prompt / Claude 吐的 stdout / 容器元数据"。
  prompt_sent: Annotation,
  raw_stdout: Annotation,
  raw_stderr: Annotation,
  exit_code: Annotation,
  duration_ms: Annotation,
  container_id: Annotation,

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

// ─── WF-3 观察性：payload 字段截断上限 ──────────────────────────
// 避免 event.payload 在 Postgres 里爆掉（单 row 默认 JSONB 无硬上限，但前端加载
// 多轮事件时若每条都几 MB 会拖慢）。取值对齐任务 card：prompt 8KB / stdout 10KB / stderr 2KB。
export const PROMPT_SENT_MAX_BYTES = 8 * 1024;
export const RAW_STDOUT_MAX_BYTES = 10 * 1024;
export const RAW_STDERR_MAX_BYTES = 2 * 1024;

/**
 * 按 char 截断字符串，保留开头并追加省略标记。
 * 空字符串 / null / undefined 统一返回 ''。
 */
export function clipText(text, maxBytes) {
  if (text === null || text === undefined) return '';
  const s = typeof text === 'string' ? text : String(text);
  if (s.length <= maxBytes) return s;
  return s.slice(0, maxBytes) + `\n... [truncated, original ${s.length} chars]`;
}

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
      (state) => {
        // round>=3 兜底（PR #2522）让 LLM 5 维评分浮动不卡门，但不能覆盖"产物空"硬信号：
        //   R0 "文件存在"（copy.md / article.md）fail → 真没产物，兜底推下去 generate/export 也会挂
        //   R3/R4 字数（copy<200 / article<500）fail → 产物太短，等同没产物
        // 这些硬规则 false 时即便 round>=3 也回 copywrite 重试。
        // LangGraph recursion_limit (60) 自然兜底阻止无限循环（pipeline failed 比空推到 NAS 更诚实）。
        // 只有 LLM D1-D5 维度持续 ≤1 的评分浮动场景，才允许 round>=3 兜底推进。
        const round = state.copy_review_round || 0;
        if (state.copy_review_verdict === 'APPROVED') {
          return 'generate';
        }
        if (round >= 3) {
          const rules = state.copy_review_rule_details || [];
          const hardRuleFail = rules.some((r) =>
            (r?.id === 'R0' || r?.id === 'R3' || r?.id === 'R4') && r?.pass === false
          );
          if (!hardRuleFail) {
            return 'generate';
          }
          // 硬规则 fail：回 copywrite 重试，让 recursion_limit 兜底挂掉 pipeline
        }
        return 'copywrite';
      },
      { generate: 'generate', copywrite: 'copywrite' },
    )
    .addEdge('generate', 'image_review')
    .addConditionalEdges(
      'image_review',
      (state) => {
        // 同步硬兜底：image_review 3 轮仍 FAIL → 强推 PASS 进 export
        const round = state.image_review_round || 0;
        if (state.image_review_verdict === 'PASS' || round >= 3) {
          return 'export';
        }
        return 'generate';
      },
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
 * @param {object} [opts.checkpointer] BaseCheckpointSaver；不传则用 PgCheckpointer 单例（v2 C8b 默认）
 */
export async function compileContentPipelineApp({ overrides, checkpointer } = {}) {
  const graph = buildContentPipelineGraph(overrides);
  const saver = checkpointer || (await getPgCheckpointer());
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
    // copy_review_total：skill 输出字段名和 state 字段名一致，直接抽。
    json_outputs: ['copy_review_rule_details', 'copy_review_total'],
    verdict_field: 'copy_review_verdict',
    verdict_values: ['APPROVED', 'REVISION'],
    // P0-3：copy_review 是纯打分/判定任务（LLM 只读 copy.md + article.md 按
    // 5 维打分），不需要 Opus 的深度推理。pipeline 3e3f2c09 单次 copy_review
    // 用 Opus 4.7 花 $0.96 USD，多轮 REVISION 回路代价高。切到 Haiku（最便宜
    // 档），成本可降 10-20x；Haiku 对单文档打分场景完全够用。
    //
    // 值对齐 claude CLI --model 的 alias 规范：'sonnet' / 'opus' / 'haiku' 或
    // 完整模型名（如 'claude-haiku-4-5-20251001'）。空/不存在时走容器默认
    // 账号 tier，不注入 --model。
    model: 'haiku',
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
    // skill 在 JSON 里输出 "vision_avg"（非 "image_review_vision_avg"），
    // 这里列 skill 实际字段名；extractNodeOutputs 会把 vision_avg 映射到
    // state 顶级字段 image_review_vision_avg。
    json_outputs: ['image_review_rule_details', 'vision_avg'],
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

  // output contract：告诉 Claude stdout 最后要输出哪些字段
  // cfg.outputs = 字符串字段（简单 key:value）
  // cfg.json_outputs = 结构化字段（rule_details 这种数组/对象）
  const jsonOutputs = cfg.json_outputs || [];
  const jsonLines = jsonOutputs.map((f) => `    "${f}": [ ... 来自 SKILL 的 bash 计算 ... ]`);
  const outputContract = cfg.verdict_field
    ? `\n\n## 输出要求\n在 stdout 最后一行输出**单行 JSON**（SKILL.md 要求的格式，不可省略任何字段）：\n\`\`\`json\n{\n    "${cfg.verdict_field}": "${cfg.verdict_values.join('|')}",\n${cfg.outputs.map((f) => `    "${f}": "<内容或 null>"`).join(',\n')}${jsonLines.length > 0 ? ',\n' + jsonLines.join(',\n') : ''}\n}\n\`\`\`${jsonOutputs.length > 0 ? `\n\n**重要**：${jsonOutputs.join(', ')} 字段是 Brain 驱动前端规则明细展示的核心，**必须由 SKILL 的 bash 逻辑计算并输出**，不可省略。` : ''}`
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
   * 构建 prompt → 调 executeInDocker → 解析输出 → 返回 state 更新 + 观察性 meta。
   *
   * 返回值（WF-3 扩展）：
   *   - output, error, success  — 已有，供节点决策/产物提取使用
   *   - meta                    — 新增，含 prompt_sent / raw_stdout / raw_stderr /
   *                               exit_code / duration_ms / container_id，
   *                               供 makeNode 塞进 state 供 runner.onStep 写事件
   */
  async function runDockerNode(nodeName, state) {
    const cfg = NODE_CONFIGS[nodeName];

    // C8b 幂等门：state 已有该节点 primary output → 跳过 docker spawn
    // （C6 / C8a 教训：LangGraph resume 会 replay 上次未完成节点 → 重 spawn 烧容器）
    const primaryField = cfg.outputs[0];
    if (primaryField && state[primaryField]) {
      console.log(`[content-pipeline-graph] node=${nodeName} task=${taskId} resume skip (state.${primaryField} exists)`);
      return {
        output: '',
        error: null,
        success: true,
        meta: { resumed: true, prompt_sent: '', raw_stdout: '', raw_stderr: '', exit_code: null, duration_ms: 0, container_id: null },
      };
    }

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
        // P0-3：节点可选声明使用的 claude model（alias 或完整名）。
        // 空/不存在时 executor 不注入 --model，走容器默认 tier。
        model: cfg.model,
      });

      const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
      const success = result.exit_code === 0 && !result.timed_out;
      console.log(
        `[content-pipeline-graph] node=${nodeName} task=${taskId} exit=${result.exit_code} timed_out=${result.timed_out} duration=${durationSec}s`
      );

      // 观察性 meta：无论 success/fail 都带出，让前端能看到失败节点的原始输入/输出
      const meta = {
        prompt_sent: clipText(prompt, PROMPT_SENT_MAX_BYTES),
        raw_stdout: clipText(result.stdout, RAW_STDOUT_MAX_BYTES),
        raw_stderr: clipText(result.stderr, RAW_STDERR_MAX_BYTES),
        exit_code: typeof result.exit_code === 'number' ? result.exit_code : null,
        duration_ms: typeof result.duration_ms === 'number'
          ? result.duration_ms
          : Date.now() - startMs,
        container_id: result.container_id || null,
      };

      if (!success) {
        const errMsg = result.timed_out
          ? `Docker timeout after ${durationSec}s`
          : `Docker exit code ${result.exit_code}: ${(result.stderr || '').slice(-500)}`;
        return { output: '', error: errMsg, success: false, meta };
      }

      const output = parseDockerOutput(result.stdout);
      return { output, error: null, success: true, meta };
    } catch (err) {
      console.error(`[content-pipeline-graph] node=${nodeName} task=${taskId} error: ${err.message}`);
      // executor 异常（network/模块错误等）没有 docker 结果，meta 退化到可用字段
      const meta = {
        prompt_sent: clipText(prompt, PROMPT_SENT_MAX_BYTES),
        raw_stdout: '',
        raw_stderr: clipText(err.message || '', RAW_STDERR_MAX_BYTES),
        exit_code: null,
        duration_ms: Date.now() - startMs,
        container_id: null,
      };
      return { output: '', error: err.message, success: false, meta };
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

    // JSON outputs（数组/对象/标量）— 从 stdout 最后一行 JSON 抽
    // skill 字段名 → state 字段名的映射表：skill 输出用更短的命名（vision_avg），
    // state 用语义更清晰的顶级名（image_review_vision_avg）；映射关系在此处落地，
    // 避免改 skill.md（P0-3/4 边界：不动 skill）。
    const JSON_FIELD_ALIAS = {
      vision_avg: 'image_review_vision_avg',
    };
    for (const field of (cfg.json_outputs || [])) {
      const v = extractJsonField(output, field);
      if (v !== null && v !== undefined) {
        const stateField = JSON_FIELD_ALIAS[field] || field;
        update[stateField] = v;
      }
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
    const { output, error, success, meta } = await runDockerNode(nodeName, state);
    // meta 字段（prompt_sent / raw_stdout / raw_stderr / exit_code / duration_ms /
    // container_id）铺平到返回值里。LangGraph 用 default reducer（overwrite），
    // 每个节点只保留自己这次的 meta；下一个节点启动前会覆盖。
    const metaUpdate = meta || {};
    if (!success) {
      return { ...metaUpdate, error, trace: `${nodeName}(ERROR)` };
    }
    return { ...metaUpdate, ...extractNodeOutputs(nodeName, output, state), error: null };
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
