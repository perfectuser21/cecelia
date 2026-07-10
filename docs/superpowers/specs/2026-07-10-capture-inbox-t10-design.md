# 设计：九要素T10 统一收件箱通电（capture_atoms 写入 + 分诊 tick + Invariant Gate）

日期：2026-07-10
上游：`docs/architecture/2026-07-10-nine-elements-integrity/addendum-01-execution-telemetry-and-inbox.md`（已批准）
任务：Brain task f9b58d4a（nine-elements-integrity plan_seq=10）

## 目标

`capture_atoms` 表结构完备但空转（仅 1 条记录）。本 sprint 通电三件事：
1. handoff / learning / issue 三条产出路径写入时"顺手推"一条 capture_atom（推模式，addendum 决策）
2. 异步分诊 tick：便宜规则优先 + LLM 兜底，四路分诊（紧急插队 / 挂 Line backlog / 候选铁律 / 走 OKR）
3. Invariant Gate：候选铁律必须过四查（冲突 / 可验证 / scope / 与累积FR矛盾）才允许写 `decisions category='invariant'`

## 调研修正（设计文档 vs 真实代码的偏差，已确认）

| addendum 原文 | 真实代码 | 本设计采用 |
|---|---|---|
| 便宜规则用 `source_type` | schema 无此列，只有 `target_type`/`target_subtype`（migration 199） | 用 `target_type` 承载来源标记（'handoff'/'learning'/'issue'，VARCHAR 无 CHECK 约束），`target_subtype` 承载判据（verdict/priority/category）。不加 migration |
| 改 `tick-runner.js` 注册 | tick-runner 的 runXxxIfNeeded 已全部 DEPRECATED（executeTick 不再被调） | 注册进 `scheduler-jobs.js` 的 `JOBS` 数组（同 T5 line-dreaming 模式），间隔 gate 内置在 handler |
| 改 `routes/issues.js` | 该文件不存在；真实 INSERT INTO issues 在 `ledger-hygiene.js:240` 和 `test-lifecycle-patrol.js:82` | 两处调用点各加一行推送 |
| saveHandoff 收尾插入 | saveHandoff 是协议 SSOT 但当前 engine-pr-watchdog 用裸 SQL 写 tasks.result.handoff，不经过它 | 仍按设计在 saveHandoff 内插入（协议收敛点）；watchdog 裸 SQL 路径的覆盖留待后续（见"不包含"） |

## 组件

### 1. `packages/brain/src/capture-inbox.js`（新建，写入 helper）

```js
export async function pushCaptureAtom(pool, { content, target_type, target_subtype, routed_to_table, routed_to_id })
```
- 单条 INSERT INTO capture_atoms（capture_id 留 NULL，status 默认 'pending_review'）
- **绝不 throw**：try/catch 全吞，失败只 console.warn——进箱失败不允许阻塞 handoff/learning/issue 主流程
- 写入时 `routed_to_table`/`routed_to_id` 作为**来源指针**（addendum L60 原案：handoff → 'tasks'/task_id）

### 2. 三处写入点

| 位置 | 时机 | 字段映射 |
|---|---|---|
| `handoff.js` saveHandoff() L111 校验成功后 | DB 主写成功之后、markdown 镜像之前 | target_type='handoff'，target_subtype=verdict（PASS 且 next_steps 非「完成，无下一步」时用 'PASS+NEXT'），content=title+done/not_done/next_steps 摘要，routed_to='tasks'/task_id |
| `learning.js` recordLearning() L116 落库成功后 | INSERT RETURNING 之后（T9 噪音过滤已在入口拦截，此处天然只收真 learning） | target_type='learning'，target_subtype=category，content=summary 或 content 截断 500 字，routed_to='learnings'/learning.id |
| `ledger-hygiene.js` raiseBreachAlerts + `test-lifecycle-patrol.js` 两处 INSERT INTO issues 后 | INSERT 改 RETURNING id | target_type='issue'，target_subtype=priority，content=title+body 截断，routed_to='issues'/issue.id |

### 3. `packages/brain/src/capture-triage.js`（新建，tick job）

handler `runCaptureTriage()`（内置 gate：间隔默认 10 分钟，env `CECELIA_CAPTURE_TRIAGE_INTERVAL_MS`；每轮批量上限默认 20，env `CECELIA_CAPTURE_TRIAGE_BATCH`）：

1. 读 `capture_atoms WHERE status='pending_review' AND target_type IN ('handoff','learning','issue') ORDER BY created_at LIMIT batch`（只分诊三类新来源，不碰 capture-digestion 产出的 note/knowledge 等既有人工复核流）
2. **便宜规则层**（纯函数 `applyCheapRules(atom)`，可单测）：

| 条件 | 判定 | confidence |
|---|---|---|
| target_type='issue' AND target_subtype IN ('P0','P1') | 紧急插队 | 1.0 |
| target_type='learning' AND content LIKE '%根本原因%' | 候选铁律 → Invariant Gate | 0.8 |
| target_type='handoff' AND target_subtype='FAIL' | 挂 Line backlog | 0.9 |
| target_type='handoff' AND target_subtype='PASS+NEXT' | 挂 Line backlog | 0.7 |
| 都不命中 | LLM 兜底 | — |

3. **LLM 兜底层**：`callLLM('thalamus', prompt, {...})`（复用 `llm-caller.js`），输出 JSON `{route, confidence, reason}`；confidence < 0.7 或解析失败 → 留 pending_review + ai_reason 记录。env `CECELIA_CAPTURE_TRIAGE_LLM=off` 可关（规则打不中就留箱）
4. **四路落地（thin 语义）**：
   - 紧急插队：status='confirmed'，ai_reason='[triage:urgent] …'，routed_to 保持指向源 issue（不自动建任务，避免与既有 issue 流重复）
   - 挂 Line backlog：status='confirmed'，routed_to_table='journeys'，routed_to_id=源 handoff 的 journey_id（源无 journey_id → 留 pending_review）
   - 候选铁律：进 Invariant Gate（见下）
   - 走 OKR：status='confirmed'，ai_reason='[triage:okr] …'（不自动改 goals，人工在复核界面处理）
5. 每条处理写回 confidence + ai_reason + updated_at

### 4. `packages/brain/src/invariant-gate.js`（新建）

```js
export async function checkInvariantCandidate(pool, atom) → { pass, checks: {conflict, verifiable, scope, fr_contradiction}, reason }
```
- 单次 `callLLM('cortex', …)`：prompt 附上既有铁律清单（`SELECT topic, decision FROM decisions WHERE category='invariant' AND status='active'`）+ 候选内容，要求输出四查 JSON
- 四查全 PASS → INSERT INTO decisions（列对齐 `routes/abilities.js` L131 结构：category='invariant', topic, decision, reason, made_by='capture-triage'），atom 更新 routed_to_table='decisions'/routed_to_id=新 id、status='confirmed'
- 任一 FAIL 或 LLM 解析失败 → atom 留 pending_review，ai_reason 记四查明细
- mock 友好：LLM 调用通过可注入参数（默认 callLLM），四查各自独立可控

### 5. `packages/brain/src/scheduler-jobs.js`（修改）

- import `runCaptureTriage`，JOBS 数组加一行 `{ name: 'capture-triage', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runCaptureTriage, description: '收件箱四路分诊' }`
- JOBS.length 哨兵自动同步，无需别处改

## 错误处理

- pushCaptureAtom 全吞异常（主流程零影响）
- triage 单条失败不中断本轮其余条目（逐条 try/catch）
- LLM 超时/解析失败 → 该条留 pending_review，下轮不重复烧钱：ai_reason 打 `[triage:llm_failed]` 标记，规则层跳过已带此标记的条目（防死循环重试；人工复核兜底）

## 测试策略（unit + integration 档）

- **unit**：`capture-inbox.test.js`（正常插入 + pool 抛错时吞掉不 throw）；`handoff.test.js` 扩展（saveHandoff 成功后调用了 pushCaptureAtom、DB 失败时不调用）；`learning` 测试扩展（落库后推送、task_completion 被 T9 拦截时不推送）；`capture-triage.test.js` 便宜规则纯函数全表用例；`invariant-gate.test.js` mock LLM 四查独立可控（全过写 decisions / 任一挂留 pending_review / 解析失败留 pending_review）
- **integration（mock pool + mock LLM）**：triage handler 对四类样例 atom 的分诊结果符合规则表；间隔 gate 生效（同轮第二次调用跳过）
- **不需要 E2E**：无 UI、无外部平台，DB 行为由 mock pool SQL 断言覆盖（repo 既有模式，见 scheduler-jobs.test.js / handoff.test.js）

## 不包含

- engine-pr-watchdog 裸 SQL 写 handoff 路径的进箱覆盖（skill 侧改动属 zenithjoy-skills repo，另行立项；saveHandoff 是协议收敛点，未来调用方收敛后自然覆盖）
- "紧急插队"自动建任务、"走 OKR"自动改 goals（thin 阶段只分类+标记，避免自动写放大脏数据风险）
- capture_atoms 加列 / migration（addendum 明确无 schema 变更）
- 复核 UI（routes/capture-atoms.js 的 confirm/dismiss 已存在）

## 版本

Brain minor bump：package.json 1.246.0 → 1.247.0（feat），以 `scripts/check-version-sync.sh` 输出为准同步其余位置。
