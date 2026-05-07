# Spec: 修复 harness_initiative pipeline task-plan.json 永不生成 (#2819)

**作者**: Alex / Claude  
**日期**: 2026-05-07  
**状态**: Draft  
**关联 Issue**: https://github.com/perfectuser21/cecelia/issues/2819  
**Brain Task**: 60373bcc-7850-4140-9042-3d6e99e4eeef

---

## 1. 背景与根因

Harness v8 把 task-plan 拆出权从 planner 转给 proposer，但实际从未真正落地。4 路并行诊断（2026-05-07）确认链条：

| 环节 | 现状 | 应有 |
|---|---|---|
| Proposer SKILL Step 3 | 写 task-plan.json 但门槛是"仅在 Reviewer APPROVED 时执行" | 每轮都写（Proposer 看不到 Reviewer 判决） |
| GAN graph 流转 | reviewer APPROVED → END，proposer 不再跑 | 同（不重构图） |
| 证据 | ab1c3887 r1/r2 + 历史 0421/0427/0425 propose 分支 **全部** 无 task-plan.json | 最后一轮 propose 分支必含 |
| inferTaskPlanNode | git show 失败 → catch 块 console.warn 返回 `{}`，taskPlan 留 null | 失败硬抛错走 error → END，立刻产 alert |
| pick_sub_task | tasks=[] → 跳到 final_evaluate → 软 FAIL | 同（仅作为兜底，正常路径不应触达） |

整条 pipeline 自 v8 切换以来一直坏，但 final_evaluate 软 FAIL 没人察觉。

---

## 2. 修复策略（最小侵入 + 防御层）

### 2.1 主修复：Proposer SKILL 每轮写 task-plan.json

**改动文件**：`packages/workflows/skills/harness-contract-proposer/SKILL.md`

- 删除 Step 3 起首"**仅在 Reviewer 输出 APPROVED 时执行**（每轮 REVISION 跳过此步，继续对抗）"
- 改为："**每轮都生成 task-plan.json**（REVISION 轮的版本在被打回的分支上无害；APPROVED 分支即最后一轮 proposer 的分支，inferTaskPlan 从此读取）"
- 删除"## 禁止事项 #4 GAN 未 APPROVED 就输出 task-plan.json"条目（与新设计冲突）
- L307 git add 注释 `2>/dev/null  # 仅 GAN APPROVED 后才有此文件` 改为 `2>/dev/null  # 每轮生成；2>/dev/null 防御 LLM 偶发漏写`
- 顶部 frontmatter version `7.0.0` → `7.1.0`，新增 changelog 7.1.0 条目说明本次修正

### 2.2 防御层 1：Proposer 节点验收 task-plan.json

**改动文件**：`packages/brain/src/workflows/harness-gan.graph.js`

- `proposer()` 函数在 `extractProposeBranch` 之后、`return` 之前，新增校验：
  ```js
  // 防御：proposer SKILL 应每轮写 sprints/task-plan.json，缺失打 warn（不阻断，给下游兜底）
  const taskPlanPath = path.join(worktreePath, sprintDir, 'task-plan.json');
  try {
    await access(taskPlanPath);
  } catch {
    console.warn(`[harness-gan] proposer round=${nextRound} missing ${sprintDir}/task-plan.json — inferTaskPlan 可能拿不到 DAG`);
  }
  ```
- 不抛错（避免单轮漏写就把整个 GAN 炸掉，给 LLM 自愈 + 兜底空间）

### 2.3 防御层 2：inferTaskPlanNode 失败硬抛错

**改动文件**：`packages/brain/src/workflows/harness-initiative.graph.js`

- L844-847 catch 块当前逻辑：
  ```js
  } catch (err) {
    console.warn(`[infer_task_plan] git show origin/${proposeBranch}:... failed: ${err.message}`);
    return {};
  }
  ```
- 改为抛错：
  ```js
  } catch (err) {
    const msg = `[infer_task_plan] git show origin/${proposeBranch}:${sprintDir}/task-plan.json failed: ${err.message}`;
    console.error(msg);
    return { error: msg };  // 走 stateHasError → error → END，触发 alert
  }
  ```
- 注意：返回 `{ error: msg }` 而非 throw，让 LangGraph state-based error 路由生效（参考 stateHasError）

---

## 3. Architecture

无架构变更。GAN 图保持 2 节点（proposer ↔ reviewer），harness-initiative 图保持 prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert → pick_sub_task → ... → END。

修改点都是节点内部行为（SKILL 流程 + JS guard），不改边、不改 state shape。

---

## 4. 组件清单与边界

| 组件 | 文件 | 改动类型 | 边界 |
|---|---|---|---|
| Proposer SKILL | `packages/workflows/skills/harness-contract-proposer/SKILL.md` | 删 1 段 + 改 1 行 + 删 1 禁条 + bump version | 仅文档 |
| GAN 图 proposer node | `packages/brain/src/workflows/harness-gan.graph.js` | 加 1 段 access 校验 | 不抛错，仅 warn |
| inferTaskPlan node | `packages/brain/src/workflows/harness-initiative.graph.js` | 改 catch 块 return | 从 `{}` 改为 `{ error }` |

---

## 5. 数据流（修改后）

```
proposer 跑 SKILL
  ├─ Step 1-2: 写 contract-draft.md + contract-dod-ws*.md + tests/
  ├─ Step 3: 写 sprints/task-plan.json  ← 每轮都做
  └─ Step 4: git add + commit + push origin cp-harness-propose-r${N}-${task}

JS proposer node
  ├─ 解析 propose_branch ← stdout
  ├─ access(worktree/sprints/task-plan.json) ← 缺则 warn
  └─ return { round, costUsd, contractContent, proposeBranch }

reviewer APPROVED → ganLoop END
inferTaskPlanNode
  ├─ git show origin/${proposeBranch}:sprints/task-plan.json
  ├─ 成功 → parseTaskPlan → return { taskPlan }
  └─ 失败 → return { error: msg } → stateHasError → END (alert 触发)
```

---

## 6. 错误处理

- proposer SKILL 偶发漏写 task-plan.json：JS proposer node 仅 warn，graph 继续；后续轮次会重写覆盖；终态若 APPROVED 但缺文件，inferTaskPlan 抛错 hard fail
- inferTaskPlan git show 失败：从静默 → 抛错 → graph 走 error → END
- error 路径会被 executor.js 的 runHarnessInitiativeRouter 捕获并 P1 alert（已有机制，无需新增）

---

## 7. 测试策略

按 Cecelia 测试金字塔分四档：

| 行为 | 档次 | 测试位置 |
|---|---|---|
| Proposer SKILL 渲染流程 | **Trivial wrapper（文档）** | 不写测试 — SKILL 是 LLM prompt，无可单元化逻辑 |
| inferTaskPlanNode catch 块行为：失败时返回 `{ error }` 而非 `{}` | **Unit** | `packages/brain/src/workflows/__tests__/harness-initiative-infer-task-plan.test.js` (新) |
| harness-gan proposer node access 校验：缺文件时打 warn 不抛错 | **Unit** | `packages/brain/src/workflows/__tests__/harness-gan-proposer-validation.test.js` (新) |
| End-to-end harness_initiative：proposer push task-plan.json → inferTaskPlan 解析成功 | **Smoke** | `packages/brain/scripts/smoke/harness-task-plan-smoke.sh` (新) |

**Smoke 脚本设计**（满足 v18.7.0 smoke.sh 强规则）：

```bash
#!/usr/bin/env bash
# harness-task-plan-smoke.sh — 验证 harness_initiative pipeline task-plan.json 链路
# 1. 起 fixture：创建临时 worktree + mock proposer 写 sprints/task-plan.json + commit + push 到本地裸仓
# 2. 调用 inferTaskPlanNode 函数（直接 require + invoke），验证 taskPlan.tasks.length >= 1
# 3. 反向验证：删 task-plan.json 后 inferTaskPlanNode 必须返回 { error: ... }
# 4. exit 0 = 通过，任一步骤失败 exit 1
```

**TDD commit 顺序**（所有 implementation task 严守）：
- commit-1：写 fail test + 空 smoke.sh 骨架
- commit-2：实现修复让 test + smoke.sh 同时变绿

---

## 8. 验收标准（DoD）

### Workstream 1: SKILL 修复

- [ARTIFACT] SKILL.md version 升到 7.1.0  
  Test: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('version: 7.1.0'))process.exit(1)"`
- [ARTIFACT] SKILL.md changelog 含 7.1.0 条目  
  Test: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!/7\.1\.0:/.test(c))process.exit(1)"`
- [ARTIFACT] SKILL.md Step 3 不再含"仅在 Reviewer 输出 APPROVED 时执行"门槛  
  Test: `! grep -q '仅在 Reviewer 输出 APPROVED 时执行' packages/workflows/skills/harness-contract-proposer/SKILL.md`
- [ARTIFACT] SKILL.md 禁止事项不再含 "GAN 未 APPROVED 就输出 task-plan.json"  
  Test: `! grep -q 'GAN 未 APPROVED 就输出 task-plan.json' packages/workflows/skills/harness-contract-proposer/SKILL.md`

### Workstream 2: 防御层

- [BEHAVIOR] inferTaskPlanNode git show 失败时返回 `{ error: ... }` 让 graph 走 error → END  
  Test: `tests/ws2/harness-initiative-infer-task-plan.test.js`
- [BEHAVIOR] harness-gan proposer node 跑完缺 task-plan.json 时打 warn 不抛错  
  Test: `tests/ws2/harness-gan-proposer-validation.test.js`

### Workstream 3: Smoke

- [ARTIFACT] `packages/brain/scripts/smoke/harness-task-plan-smoke.sh` 存在且可执行  
  Test: `node -e "require('fs').accessSync('packages/brain/scripts/smoke/harness-task-plan-smoke.sh',require('fs').constants.X_OK)"`
- [BEHAVIOR] smoke 脚本本机跑通：构造 fixture → inferTaskPlan 解析非空 tasks  
  Test: `manual:bash packages/brain/scripts/smoke/harness-task-plan-smoke.sh`

---

## 9. Out of Scope

- 不重构 GAN 图结构（不新增 finalize_proposer 节点）
- 不动 PostgresSaver / LangGraph checkpointer 行为
- 不改 reviewer SKILL
- ab1c3887 现有 worktree 不动；修完用新任务 ID 重跑验证（验证不在本 PR 范围，改完合并后人工触发）

---

## 10. 风险登记

| 风险 | 影响 | Mitigation |
|---|---|---|
| Proposer 每轮写 task-plan.json 增加 LLM token 消耗 | 边际成本上升 ~5% | 接受 — 代价远小于"软坏不报错"调试成本 |
| inferTaskPlan hard fail 后 alert 噪音上升 | 可能 P1 告警初期会多 | 接受 — 让"软坏"暴露才能修；告警就是治理触点 |
| 旧 in-flight harness_initiative 任务（如 ab1c3887）合并后会硬 fail | 可能立刻产生 1-3 条 alert | 文档说明：合并后用新任务 ID 复测，旧 in-flight 任务 cancel |

---

## 11. journey_type

`dev_pipeline`（修内部 pipeline 行为，无 user-facing 变更）
