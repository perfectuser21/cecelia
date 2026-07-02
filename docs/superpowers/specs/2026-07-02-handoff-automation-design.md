# Handoff 自动化设计（诊断方案 B：B-1 schema + B-2 harness 生成点 + B-3 planner 加载点）

> 来源：docs/current/harness-verify-redesign/2026-07-02-context-pinning-and-handoff-diagnosis.md 方案 B，主理人 2026-07-02 拍板 B→A-1→C-2。
> Brain task：dcdbf10f-7fd7-412c-abc6-4ee27d3aa906。
> 本 PR 范围：harness 无头链路的出口（reportNode）+ 入口（plannerNode）。/dev 手动生成点、有头会话收尾生成点是 skill/CLAUDE 侧改动，另行 PR。

## 问题

任务完成只走 execution-callback，沉淀散落 7 处（decisions/tasks.result/memory_stream/learnings/HANDOFF.md/harness-report/A3），下一个大脑要人工翻 3-4 个地方；无头任务完成后零 handoff 产物。目标：任务终态自动产一份**给下一个大脑读的结构化交接单**，并在下一次规划时自动加载。

## 与既有件的分工（防重复造轮）

- A3 promote-regression 沉淀**行为**（golden_path + 回归契约）
- harness-report 是**给人看**的飞书/Notion 报告
- handoff 沉淀**进度与意图**（做到哪/剩什么/下一步/去哪加载数据）——三者互补

## B-1：handoff 模块（新文件 `packages/brain/src/handoff.js`）

### schema（v1，机器读为主）

```js
{
  schema_version: 1,
  task_id: uuid,            // 必填
  initiative_id: uuid|null,
  journey_id: uuid|null,
  title: string,
  verdict: 'PASS'|'FAIL'|'MANUAL'|null,
  done: string[],           // 完成了什么（FR 级一行一条：merged PR 标题/URL）
  not_done: string[],       // 没完成什么（未合 sub_task + 失败原因摘要）
  next_steps: string[],     // 下一步建议
  data_sources: string[],   // 下一个大脑要加载的数据源（固定基线清单 + 本 journey 定制项）
  decision_refs: string[],  // 关键决策 id（v1 可空数组）
  artifacts: { pr_urls: string[], sprint_dir: string|null, branch: string|null, docs: string[] },
  created_at: ISO8601,
}
```

`data_sources` 固定基线（v1 写死在模块常量，与 harness-planner Step 0.3/0.4 同源）：
- `GET /api/brain/invariants?level=area`
- `GET /api/brain/invariants?target_type=journey_feature&target_id=<ability_id>`
- `GET /api/brain/journeys/<journey_id>/golden-paths`
- `GET /api/brain/tasks/<task_id>`（result.handoff 本体）

### API

- `buildHandoff(input)` → 校验必填（task_id）+ 填默认值 + 截断（done/not_done/next_steps 每条 ≤200 字、每组 ≤20 条），返回 handoff 对象；非法输入 throw。
- `saveHandoff({ pool }, handoff)` →
  1) `UPDATE tasks SET result = COALESCE(result,'{}') || jsonb_build_object('handoff', $2::jsonb) WHERE id=$1`（DB 是 SSOT）；
  2) best-effort 写 markdown 镜像 `<HANDOFF_DOCS_DIR>/<yyyymmddHHMM>-<task8>.md`（`HANDOFF_DOCS_DIR` env，默认 `/Users/administrator/perfect21/cecelia/docs/handoffs`，容器/宿主同路径挂载；写失败仅 warn，不影响 DB 写入结果）。**不自动 git commit**（人读镜像，untracked 即可，避免 A3 式专属 PR 的复杂度）。
- `renderHandoffMarkdown(handoff)` → 人读 md（含全部字段，中文标题）。
- `getRecentHandoffs({ pool }, { journeyId, limit=3 })` → `SELECT id, title, completed_at, result->'handoff' AS handoff FROM tasks WHERE payload->>'journey_id'=$1 AND result ? 'handoff' AND id != <excludeTaskId?> ORDER BY completed_at DESC NULLS LAST LIMIT $2`。
- `formatHandoffsForPrompt(rows)` → `## 最近 Handoff（本 line 交接）` 文本段：每份 handoff 压缩为 ≤6 行（verdict/done 前3条/not_done 前2条/next_steps 前2条），总长 ≤2000 字（注入膨胀控制）。空数组 → 返回 ''。

## B-2：harness 生成点（`harness-initiative.graph.js` reportNode）

位置：A3 promotion 块之后、spawnHarnessReport 之前（PASS/FAIL **两分支都生成**——失败的交接单价值更大）。模式复制 A3：dynamic import + try/catch warn，**best-effort 绝不阻断生命周期闭合**。

```js
try {
  const { buildHandoff, saveHandoff } = await import('../handoff.js');
  const handoff = buildHandoff({
    task_id: state.initiativeId,
    initiative_id: state.initiativeId,
    journey_id: state.task?.payload?.journey_id || null,
    title: state.task?.title || '',
    verdict: computedVerdict,
    done: reconciledSubTasks.filter(s => s.status==='merged').map(s => `${s.id}: ${s.pr_url||''}`),
    not_done: reconciledSubTasks.filter(s => s.status!=='merged').map(s => `${s.id}(status=${s.status}${s.ci_fail_type?`,ci=${s.ci_fail_type}`:''})`),
    next_steps: computedVerdict==='PASS'
      ? ['本 ability 已验收，golden_path 已冻结（A3）；下一 sprint 可加厚或推进下一 ability']
      : [`修复后重试：${reason 摘要 ≤200字}`],
    artifacts: { pr_urls, sprint_dir: state.sprintDir||null, branch: null, docs: [] },
  });
  await saveHandoff({ pool: dbPool }, handoff);
} catch (err) { console.warn(`[reportNode] handoff generation failed (non-fatal): ${err.message}`); }
```

幂等：reportNode 已有 report_path 幂等门；`result || jsonb` 覆盖写本身幂等。

## B-3：planner 加载点（同文件 runPlannerNode）

与既有 runHistoryText 注入同模式（代码注入，不靠 skill curl）：journey_id 非空时 `getRecentHandoffs` 拉 ≤3 份（排除本 task 自身），`formatHandoffsForPrompt` 生成文本段，append 到 planner prompt（紧跟 runHistoryText 之后）。try/catch warn，失败不阻塞 spawn。

## 错误处理总则

生成/加载任何一步失败 → warn 日志 + 主流程继续（与 A3/runHistoryText 同纪律）。DB 写失败时不写 markdown（避免文件有 DB 无的分裂态：先 DB 后文件）。

## 测试策略

- **unit**（`packages/brain/src/__tests__/handoff.test.js`，mock pool）：buildHandoff 校验/默认值/截断；saveHandoff DB SQL 断言 + markdown 写盘（临时目录 env）+ DB 失败不写文件；renderHandoffMarkdown 字段齐全；getRecentHandoffs SQL 参数；formatHandoffsForPrompt 压缩/空数组/长度上限。
- **wiring**（扩展现有 reportNode/planner 测试文件或新建）：reportNode PASS 与 FAIL 两分支均触发 saveHandoff（mock import）；handoff throw 时 reportNode 仍正常返回 report_path；plannerNode prompt 含「最近 Handoff」段（有数据时）/ 不含（无数据时）；getRecentHandoffs throw 时 spawn 照常。
- **real-env smoke**（`packages/brain/scripts/smoke/handoff-smoke.sh`）：真 DB 事务 BEGIN…ROLLBACK 内 INSERT 假任务 → node -e 调 buildHandoff+saveHandoff → 查回 result.handoff → getRecentHandoffs 命中（沿用 E2 smoke 的事务隔离防误写教训）。
- **E2E**：不单独做（handoff 的端到端验证 = 下一次真实 harness run 的 planner prompt 里出现该段，跟随 A1 DoD5 同批真验）。

## 不做（YAGNI）

- 不做 `GET /tasks/:id/handoff` 独立端点（tasks 详情端点已带 result）
- 不做 /dev 手动路径与有头会话生成点（skill/CLAUDE 侧，另 PR）
- 不做 handoff 历史版本链（覆盖写即可，git 镜像天然留痕）
- 不改 DB schema
