/**
 * qiumi-source.js
 *
 * `tasks.payload.metadata.qiumi_source` 的唯一真身。
 *
 * 原为 `notion-push-sync.js:411-416` 的内联对象字面量，消费方（cheap-gates、
 * 两个 smoke、若干测试）各自手搓一份形状。2026-09-23 实证：写入方存
 * `agent_workflow_ids`，而 `routing/cheap-gates.js` 读 `src.relations.workflows`
 * ——生产代码零处写过后者，主理人在 Notion 填的「执行 Agent / Workflow」被整条
 * 丢弃。两头各自有绿测试，中间没有横跨两端的契约测试，故漂了也没人知道。
 *
 * 抽到这个中立叶子模块（不依赖任何业务模块）的理由同 lib/ssh-args.js：让
 * `routing/cheap-gates.js` 去 import `notion-push-sync.js` 会拖进整条 Notion
 * API / DB pool 重依赖链，造成分层倒置。同域先例：lib/qiumi-status-map.js。
 * 对应 invariant 76cb816c：语义常量只允许一份，手抄同值副本 = 隐形炸弹。
 *
 * 两层导出：
 *  - buildQiumiSource(flat)      扁平层，消费方（测试/smoke）用这个，不必伪造 Notion 页
 *  - qiumiSourceFromNotion(...)  Notion 层，封 zh?.x ?? en.y 回落，notion-push-sync 用这个
 * 单层（只有 Notion 层）会逼消费方伪造 zh/en，等于把漂移从 qiumi_source 挪到 zh。
 */

/**
 * 扁平层：十个键齐全。
 * title/remark/body 不设默认值——原字面量对这三个键就是"有什么给什么"，
 * 设了默认会把 undefined 变成 ''，落 jsonb 时从"无此键"变成"空串"，非等价。
 */
export function buildQiumiSource({
  title,
  remark,
  body,
  priorityRaw = null,
  dueAt = null,
  channel = null,
  agentWorkflowIds = [],
  skillIds = [],
  businessTaskIds = [],
  ownerIds = [],
} = {}) {
  return {
    title,
    remark,
    body,
    priority_raw: priorityRaw,
    due_at: dueAt,
    channel,
    agent_workflow_ids: agentWorkflowIds,
    skill_ids: skillIds,
    business_task_ids: businessTaskIds,
    owner_ids: ownerIds,
  };
}

/** Notion 层：封回落逻辑，供 notion-push-sync.js 调用。 */
export function qiumiSourceFromNotion({ title, zh, en, zhBody, enBody, dueAt }) {
  return buildQiumiSource({
    title,
    // ?? 不是 ||：plain()（notion-gtd-sync.js:34）恒返回字符串，中文「备注」为空
    // 时是 ''，此时**不**回落 en.description。改成 || 就改了语义。
    remark: zh?.remark ?? en.description,
    // || 不是 ??：中文正文为空串时**必须**回落英文正文。与上一行刻意不同。
    body: zhBody || enBody,
    priorityRaw: zh?.priorityRaw ?? null,
    dueAt,
    channel: zh?.channel ?? null,
    // zh === null 是真实路径（notion-push-sync.js:384 反查不到中文行），
    // 可选链不能丢，否则 TypeError。
    agentWorkflowIds: zh?.agentWorkflowIds ?? [],
    skillIds: zh?.skillIds ?? [],
    businessTaskIds: zh?.businessTaskIds ?? [],
    ownerIds: zh?.ownerIds ?? [],
  });
}
