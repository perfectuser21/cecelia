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
