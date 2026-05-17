# Harness Proposer/Graph propose_branch 协议 Mismatch 修复

**日期**: 2026-05-08
**Initiative**: Harness LangGraph 14 节点端到端验证（W8 acceptance）
**触发事件**: W8 task `49dafaf4` 在 inferTaskPlan 节点硬 fail，根因为 SKILL/Graph 协议不一致

---

## 背景与实证

2026-05-08 凌晨完成 Brain 部署稳定化（双 Brain 收敛 + 5 PR 修复部署 + 端口冲突解决）后，跑 W8 acceptance task `49dafaf4-1d84-4da4-b4a8-4f5b9c56facf` 期待 14 节点端到端跑通。**6/7 PRD 验收项绿**，**1/7 fail**：W8 task 跑了 30 分钟最后 status=failed，graph 推到 inferTaskPlan 节点报：

```
[infer_task_plan] git show origin/cp-05080823-49dafaf4:sprints/w8-langgraph-v3/task-plan.json failed:
fatal: invalid object name 'origin/cp-05080823-49dafaf4'
```

实证：
- ✅ origin 上**有** `cp-harness-propose-r1-49dafaf4` + `cp-harness-propose-r2-49dafaf4` 两个分支
- ✅ 两个分支**都含真实 task-plan.json**（PR #2820 修复实证有效）
- ❌ graph 找的是 `cp-05080823-49dafaf4`，origin 上**没有这个分支**

## 精确根因

### `packages/brain/src/workflows/harness-gan.graph.js` line 393
```js
const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId);
```
- `extractProposeBranch` 用正则 `/"propose_branch"\s*:\s*"([^"]+)"/` 找 proposer SKILL stdout 里的 JSON 字面量
- 每轮 GAN proposer 调用后立刻执行（line 391 注释说"即使本轮被打回也先把 branch 存下"）

### `packages/workflows/skills/harness-contract-proposer/SKILL.md` Step 4 line 314-318
```
**最后一条消息**（GAN APPROVED 后）：

{"verdict": "PROPOSED", ..., "propose_branch": "cp-harness-propose-r1-xxxxxxxx", ...}
```

**关键 bug**：SKILL 文档把 verdict JSON 输出**限定在 "GAN APPROVED 后"**——LLM 按字面理解，r1/r2 没 APPROVED 时**不输出 JSON** → graph extractProposeBranch 找不到 → 走 fallback。

### `fallbackProposeBranch` line 182-189
```js
return `cp-${stamp}-${String(taskId || 'unknown').slice(0, 8)}`;
// 实际生成: cp-MMDDHHmm-XXXXXXXX, 例 cp-05080823-49dafaf4
```
跟 SKILL 实际 push 格式 `cp-harness-propose-r{N}-{taskIdSlice}` **完全不一致**——任何走 fallback 的 case 都拿到错的分支名 → inferTaskPlan 硬 fail。

### 责任分配
| Bug 来源 | 修法 |
|---|---|
| SKILL Step 4 把 verdict JSON 输出限定在 APPROVED 后 | 改成"每轮"输出 |
| Graph fallback 格式跟 SKILL push 格式不一致 | fallback 改用相同格式（防御） |

---

## 候选方案

### 方案 A：双修（SKILL + Graph fallback）★ 推荐
- **SKILL 改动**：`packages/workflows/skills/harness-contract-proposer/SKILL.md` Step 4 line 314 把"**最后一条消息（GAN APPROVED 后）**"改成"**每轮最后一条消息（含被打回轮）**"
- **Graph 改动**：`fallbackProposeBranch` 函数签名加 `round` 参数，改用 `cp-harness-propose-r{round}-{taskIdSlice}` 格式；调用点 line 393 传入 `nextRound`
- 双层防护，任一处工作 graph 都能拿对的分支
- 优点：safest，避免 LLM 偶发不听话；fallback 跟 SKILL 实际格式一致后即使 stdout 完全没 JSON 也能命中
- 缺点：改两处，测试覆盖更多

### 方案 B：只修 SKILL
- 假设 LLM 总是听话 → SKILL 改后总能输出 JSON
- 不动 graph fallback
- 优点：minimal，单文件改动
- 缺点：LLM 偶发不听话（实际 W8 r1/r2 r3/r4 多次发生），fallback 永远错；违反"防御性编程"原则

### 方案 C：只修 Graph fallback + 增强容错
- 不动 SKILL，graph fallback 改成 `cp-harness-propose-r{round}-{taskIdSlice}` 格式
- 加一层 `git ls-remote origin "cp-harness-propose-r${round}-*"` 兜底找最新
- 优点：把责任收回 graph，不依赖 LLM 听话
- 缺点：掩盖 SKILL 文档错误，将来同样的协议 mismatch 会在其他场景再次咬人；ls-remote 加 IO 慢

**选 A**：双修最稳，且 SKILL 改动只是删几个字 + 改一行表述，fallback 改动只是改格式 + 加参数，工作量不大但安全等级最高。

---

## 设计

### 架构
```
proposer SKILL (workflows/skills/harness-contract-proposer/SKILL.md)
  ↓ stdout 每轮输出 verdict JSON (含 propose_branch)
extractProposeBranch (brain/src/workflows/harness-gan.graph.js)
  ↓ 命中 → 返回 SKILL 报的真实分支名
  ↓ 漏命中 → fallbackProposeBranch(taskId, round) 用相同格式生成兜底
  ↓
state.proposeBranch
  ↓
inferTaskPlan: git show origin/${proposeBranch}:${sprintDir}/task-plan.json
```

### 改动清单

#### 1. SKILL 改动 — `packages/workflows/skills/harness-contract-proposer/SKILL.md`

**Step 4 line 314 修改**：
```diff
-**最后一条消息**（GAN APPROVED 后）：
+**最后一条消息**（每轮 — 含被 REVISION 打回轮）：
```

**新增明示约束**（line 314 之后）：
```markdown
**输出契约**：每轮 proposer 调用结束时 stdout 必须含且仅含一行 JSON 字面量含 `verdict` + `propose_branch` 字段，brain 端 harness-gan.graph.js extractProposeBranch 用正则 `/"propose_branch"\s*:\s*"([^"]+)"/` 解析。**漏写会导致 graph 走 fallback，可能命中错误分支名**。
```

**version bump**：`SKILL.md` frontmatter version `7.1.0` → `7.2.0`，changelog 新增条目。

#### 2. Graph 改动 — `packages/brain/src/workflows/harness-gan.graph.js`

**`fallbackProposeBranch` 函数签名 + 实现**（line 182-189）：
```diff
-export function fallbackProposeBranch(taskId, now = new Date()) {
-  const parts = ...;
-  const stamp = `${parts.month}${parts.day}${parts.hour}${parts.minute}`;
-  return `cp-${stamp}-${String(taskId || 'unknown').slice(0, 8)}`;
+export function fallbackProposeBranch(taskId, round) {
+  const taskSlice = String(taskId || 'unknown').slice(0, 8);
+  const r = Number.isInteger(round) && round >= 1 ? round : 1;
+  return `cp-harness-propose-r${r}-${taskSlice}`;
 }
```

**调用点修改**（line 393）：
```diff
-const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId);
+const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId, nextRound);
```

#### 3. 测试改动

**Unit test** — `packages/brain/src/workflows/__tests__/extract-and-fallback-propose-branch.test.js`（新文件）：
- `extractProposeBranch` 命中 SKILL Step 4 模板的 JSON 输出
- `extractProposeBranch` 漏命中 stdout 无 JSON 时返回 null
- `fallbackProposeBranch(taskId, round)` 返回 `cp-harness-propose-r{round}-{taskIdSlice}` 格式
- `fallbackProposeBranch(taskId, undefined)` 默认 round=1
- `fallbackProposeBranch(null, 2)` 处理 null taskId 返回 `cp-harness-propose-r2-unknown`

**SKILL 文件 lint** — 通过 `[BEHAVIOR] manual:node` 命令验证 SKILL.md 含 `"propose_branch"` 输出片段且不含限定词"GAN APPROVED 后"

**Smoke test** — `packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh`（新文件）：
- 在真起的 Brain 上跑一段最小 harness graph mock
- mock proposer stdout 输出含 `"propose_branch":"cp-harness-propose-r1-deadbeef"` 的 JSON
- 验证 graph state.proposeBranch === "cp-harness-propose-r1-deadbeef"
- 第二次跑 stdout 不含 JSON，验证 fallback 命中 `cp-harness-propose-r1-deadbeef`（同格式）

#### 4. Version bump

- `packages/brain/package.json` + `package-lock.json`：1.228.3 → 1.228.4
- `packages/workflows/skills/harness-contract-proposer/SKILL.md` frontmatter `version: 7.1.0` → `7.2.0` + changelog 新增条目

`packages/workflows/` 不需要 engine 5 文件 bump（engine bump 是 `packages/engine/skills/` 的规则，跟本 PR 无关）。

#### 5. PRD/DoD 双放置

按 memory `packages/workflows/ PRD/DoD 放置` 规则：worktree 根目录 + `packages/workflows/` 各放一份。

---

## 数据流（修复后）

```
Round N:
  proposer SKILL 调用
    ↓
  SKILL 内部 git push cp-harness-propose-rN-XXXXXXXX
    ↓
  SKILL stdout 末尾输出 (新约束: 每轮都输出)
    {"verdict": "PROPOSED", "propose_branch": "cp-harness-propose-rN-XXXXXXXX", ...}
    ↓
  graph extractProposeBranch(stdout) → "cp-harness-propose-rN-XXXXXXXX"
    ↓
  state.proposeBranch = "cp-harness-propose-rN-XXXXXXXX" ✓

漏 case (SKILL LLM 偶发不输出 JSON):
  graph extractProposeBranch(stdout) → null
    ↓
  fallbackProposeBranch(taskId, nextRound) = "cp-harness-propose-rN-{taskIdSlice}" ✓ (同格式命中)
    ↓
  state.proposeBranch = "cp-harness-propose-rN-{taskIdSlice}" ✓ (实际分支也长这样)

inferTaskPlan:
  git show origin/${state.proposeBranch}:${sprintDir}/task-plan.json ✓
```

---

## 错误处理

- 当前 inferTaskPlan 已有"硬 fail 不静默"逻辑（PR #2820 加的），保留
- fallback 命中正确分支后流程正常推进
- 双层都失败的极端情况（SKILL stdout 异常 + git push 也异常）：inferTaskPlan 硬 fail → graph error END → task status=failed → alerting P2 — 这是预期行为

---

## 测试策略（dev skill 测试金字塔归类）

| 测试类型 | 目标 | 文件 |
|---|---|---|
| **Unit** | 纯函数 `extractProposeBranch` + `fallbackProposeBranch` | `packages/brain/src/workflows/__tests__/extract-and-fallback-propose-branch.test.js` |
| **Behavior** | SKILL.md 文件含约定输出片段，不含 "GAN APPROVED 后" 限定词 | `manual:node -e "fs.readFileSync(...).includes(...)"` |
| **Smoke (E2E)** | 真起 Brain + mock proposer → 验证 state.proposeBranch | `packages/brain/scripts/smoke/propose-branch-protocol-smoke.sh` |

四档归类（按 dev skill 标准）：
- 单函数行为 → Unit test ✓
- 跨模块行为（graph 编排 + SKILL 输出）→ Behavior + Smoke
- 跨进程行为（真 Brain + 真 git）→ Smoke

---

## 不做（明确范围）

- 不重写 GAN graph 流程（PR #2834 收敛检测刚合）
- 不改 inferTaskPlan 硬 fail 行为（PR #2820 设计上要保留"硬 fail 不静默"）
- 不动其他 SKILL（reviewer/planner/generator 的输出协议）
- 不改 W8 跑通后才会暴露的下游节点 bug（fanout/run_sub_task/dbUpsert/final_evaluate）
- 不动 docker-compose.yml BRAIN_MUTED / PROBE_AUTO_ROLLBACK_ENABLED env

---

## 跑通验证（PR 合并后）

1. 回原会话再跑一次 W8 acceptance task（payload 不变）
2. 期待 task status=completed
3. 期待 task_events graph_node_update 含 ≥ 14 distinct node names

如还失败，说明下游节点（fanout/run_sub_task/dbUpsert/final_evaluate 等）有别的 bug，另开 PR 修。
