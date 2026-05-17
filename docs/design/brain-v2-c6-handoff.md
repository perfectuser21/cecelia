# Brain v2 Phase C6 接力 Handoff（2026-04-24 起草）

> **谁读**：新会话（Claude / Alex）接手 Phase C6 tick 瘦身 + runWorkflow 接线 + WORKFLOW_RUNTIME 灰度。
>
> **当前状态**：Phase C1-C5 已合 main（orchestrator 骨架 + 5 个 `.graph.js` 全部入库），但 **Brain container 还跑旧 image 不含 C1-C5**。C6 开工前必须先 deploy。

---

## 0. 冷启动三步（新会话必读）

### Step 1 — 读 3 份 source-of-truth

```bash
# 原 spec（§6 是 C 的完整设计）
cat docs/design/brain-orchestrator-v2.md

# Phase A-E 整体 roadmap
cat docs/design/brain-v2-roadmap-next.md

# 本 handoff（C6 详细 PRD）
cat docs/design/brain-v2-c6-handoff.md
```

### Step 2 — 查 main HEAD + 容器状态

```bash
# main 应在 e6885c819 或更新（C4/C5 已合）
git log --oneline main -8

# 应看到：
# - workflows/ 目录 + 5 个 .graph.js
# - migration 244 存在
# - server.js 有 initializeWorkflows 调用
ls packages/brain/src/workflows/
ls packages/brain/migrations/ | tail -3
grep -c "initializeWorkflows" packages/brain/server.js

# Brain 容器版本
docker exec cecelia-node-brain node -e "console.log(require('./package.json').version)"
docker exec cecelia-node-brain ls /app/src/workflows/ 2>&1 | head -3
```

**判断标志**：若容器 `/app/src/workflows/` 报 "No such file or directory" → **未 deploy**，先走 Step 3。

### Step 3 — Brain redeploy（必做）

```bash
# 前置防事故冒烟（feedback memory brain_deploy_syntax_smoke 已记）
cd /Users/administrator/perfect21/cecelia
node --check packages/brain/server.js
node --check packages/brain/src/workflows/index.js
node --check packages/brain/src/workflows/dev-task.graph.js
node --check packages/brain/src/orchestrator/graph-runtime.js

# 官方 deploy 脚本（bump + migration + rebuild + healthcheck + 自动 rollback）
bash scripts/brain-deploy.sh

# 验证 deploy 成功
docker exec cecelia-node-brain node -e "console.log(require('./package.json').version)"  # 应 1.223.0+
docker exec cecelia-node-brain ls /app/src/workflows/
docker logs cecelia-node-brain --since 3m | grep -E "Workflows initialized|migration 244"
docker exec cecelia-pg psql -U cecelia -c "\dt checkpoints" 2>&1  # 应显示表存在
curl -s localhost:5221/api/brain/tick/status | python3 -c "import json,sys;print(json.load(sys.stdin).get('enabled'))"  # 应 true
```

**若 deploy 失败**：
- 看 `docker logs cecelia-node-brain` 找 SyntaxError / 启动 error
- 脚本自动 rollback，不会留半死状态
- 若 rollback 也失败 → 本地 python patch + `bash scripts/brain-build.sh` + `docker compose up -d --force-recreate node-brain`（见 2026-04-24 00:27 事故恢复流程）

---

## 1. C6 目标

在 `tick.js` / `executor.js` 分派逻辑接入 L2 orchestrator 的 `runWorkflow()`，用 `WORKFLOW_RUNTIME=v2` env flag 灰度切换，默认 v1（零生产影响）。Alex 手动 set env 逐个 task_type 验证。

**Scope 外**（明天/后天再做）：
- C7 清老 runner shim（观察 24-48h 稳定后再清）
- Phase D tick 进一步瘦身到 ≤ 200 行（C6 只加 flag + 路由，不动主循环结构）
- Phase E Observer 分离

---

## 2. C6 拆三个子 PR（推荐顺序）

### C6a — tick 加 WORKFLOW_RUNTIME flag + dev-task 路径接线

**改动文件**：
- `packages/brain/src/tick.js` — task_type=`dev` 分派前加 env flag 判断
- 新测试 `packages/brain/src/__tests__/tick-workflow-runtime.test.js`

**逻辑**：

```js
// tick.js task_type=dev 分派前（具体位置看现有 dispatch 路径）
if (task.task_type === 'dev' && process.env.WORKFLOW_RUNTIME === 'v2') {
  const { runWorkflow } = await import('./orchestrator/graph-runtime.js');
  const attemptN = (task.payload?.attempt_n || task.retry_count || 0) + 1;
  runWorkflow('dev-task', task.id, attemptN, task)
    .catch(err => console.error(`[tick] runWorkflow dev-task ${task.id} failed:`, err.message));
  return;  // fire-and-forget，不 await
}
// else 走原 legacy 路径
```

**DoD**：
- [BEHAVIOR] tick.js 含 `WORKFLOW_RUNTIME` 字符串；Test: manual:`grep -c WORKFLOW_RUNTIME packages/brain/src/tick.js` == 1
- [BEHAVIOR] 默认 `WORKFLOW_RUNTIME` 未设 / `v1` 时走 legacy（单测 mock env 验证）
- [BEHAVIOR] `WORKFLOW_RUNTIME=v2` 时 runWorkflow 被调用（单测 mock verify call + 验证不 await）
- [BEHAVIOR] attemptN 计算正确（retry_count=0 → attemptN=1）
- 生产默认 env 不设 → 零行为变化

**灰度切换验证（部署后手动）**：
```bash
# 1. set env，重启 Brain
docker compose exec node-brain env WORKFLOW_RUNTIME=v2 kill -HUP 1  # 或修 docker-compose.yml + up -d
# 2. 注册一个 dev task → 观察日志
curl -X POST localhost:5221/api/brain/tasks -H 'Content-Type: application/json' \
  -d '{"title":"C6a smoke","task_type":"dev","description":"echo hello"}'
docker logs -f cecelia-node-brain | grep -E "runWorkflow|dev-task"
```

### C6b — harness-initiative 路径接入 runWorkflow

**改动文件**：
- `packages/brain/src/executor.js` L2807 附近（`task.task_type === 'harness_initiative'` 分支）

**逻辑**：类似 C6a，env flag 为 v2 时调 `runWorkflow('harness-initiative', task.id, attemptN, task)`，**需要先把 harness-initiative workflow 真 register** 到 workflow-registry（目前 workflows/index.js 只注册 dev-task，补 register harness-initiative）。

**前置改动**（也在本 PR）：
- `packages/brain/src/workflows/index.js` 补 `initializeWorkflows()` 注册 harness-initiative
- 但 harness-initiative 不是 LangGraph StateGraph 而是 runInitiative 函数。需要包一层伪 `.graph.js`：定义 1-node graph → node 内调 runInitiative。类似 dev-task.graph.js 模式

**⚠️ 复杂度警告**：harness-initiative 本身是多步骤（Planner → GAN → DB upsert），把它当单 node graph 意义不大；spec §6 本意是 GAN 循环作为子图用 LangGraph checkpointer。**C6b 可能要**：
- 选项 A：暂不迁 harness-initiative 到 runWorkflow（保持 executor.js 老分派）→ C6 只做 dev-task 路径
- 选项 B：设计真正的 harness-initiative 多 node graph（Planner → GAN subgraph → DB）→ 大改 ≥ 500 行，不是 C6a 级别

**推荐**：C6 只做 C6a（dev-task 接线）；harness-initiative 和 content-pipeline 的 runWorkflow 接线延后 Phase D（tick 全瘦身时重做 dispatch 层）。

### C6c — content-pipeline 路径接入（同 C6b 理由，**建议延后**）

---

## 3. 修正后的 C6 建议 scope（精简版）

鉴于 C6b/C6c 需要真图结构重设计，**C6 只做 C6a**（dev-task 路径接线 + env flag + 崩溃 resume manual smoke）。

完整 PR 结构：

| PR | 内容 | 工作量 |
|---|---|---|
| **C6**（本轮）| tick.js 加 `WORKFLOW_RUNTIME` env flag + dev-task 走 runWorkflow（fire-and-forget）+ 单测 + manual smoke doc | 2-3h ~200 行 |
| **C7**（后续，可并行）| 保留 harness-gan-graph.js / harness-initiative-runner.js / content-pipeline-graph.js / runner.js 4 个 shim（不删）；只清 migration 244 依赖的 executor.js 散建 setup() 代码 | 1h ~80 行 |
| **C8**（原 C6b/c 推后）| harness-initiative / content-pipeline 真图结构重设计 + 接入 runWorkflow | 1-2 天（跨 turn）|
| **D** | tick 瘦身到 ≤ 200 行 + task-router | 1 周 |

---

## 4. C6 PR 完整 PRD（可直接贴 Brain task 注册）

```markdown
# Phase C6 — tick.js 加 WORKFLOW_RUNTIME flag + dev-task 走 runWorkflow

## Goal
tick.js task_type=dev 分派前加 env flag：`WORKFLOW_RUNTIME=v2` 时走 L2 runWorkflow('dev-task')，
默认 v1 走 legacy。不 await (fire-and-forget .catch logError)。

## 前置
- Brain 已 redeploy（含 C1-C5，workflows/ 目录 + migration 244 + initializeWorkflows 启动时调）

## Tasks
1. 改 tick.js：task_type=dev 分支前加 WORKFLOW_RUNTIME 判断
2. 改 workflows/index.js：确认 dev-task 已注册（C2 已做，本 PR 不改）
3. 新测试 tick-workflow-runtime.test.js：
   - env 未设 / v1 → legacy 被调
   - env=v2 → runWorkflow 被调（vi.mock）
   - attemptN 计算（retry_count + 1）
   - runWorkflow 失败 → logError，不抛不中断 tick

## 成功标准
- env 未设 → 零行为变化（生产默认安全）
- env=v2 → 真走 runWorkflow，崩溃重启 resume 可验
- 现有 tick 相关测试不退化

## 不做
- 不改 harness_initiative / content_publish 分派（C8/D）
- 不迁 executor.js 的 PostgresSaver 散建（C7）
- 不清 WORKFLOW_RUNTIME flag（C8 后再清）
- 不做 tick 瘦身（Phase D）

## DoD
- [BEHAVIOR] tick.js 含 WORKFLOW_RUNTIME 字符串 + runWorkflow 调用；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); if(!c.includes('WORKFLOW_RUNTIME')||!c.includes('runWorkflow')) process.exit(1)"
- [BEHAVIOR] 新测试 ≥ 4 cases pass；Test: tests/packages/brain/src/__tests__/tick-workflow-runtime.test.js
- [BEHAVIOR] 现有 tick 测试不退化；Test: manual:npm test --workspace=packages/brain --prefix . -- tick

## 崩溃 resume manual smoke（合并后验证，写 smoke script）
```bash
# 1. set env 重启 Brain
... (见本 handoff §2 C6a 灰度切换验证)

# 2. 注册 dev task
curl -X POST ...

# 3. 任务跑中途 kill Brain
docker kill cecelia-node-brain

# 4. 重启
docker compose up -d node-brain

# 5. 验证 checkpoint 续跑
docker exec cecelia-pg psql -U cecelia -c "SELECT thread_id, COUNT(*) FROM checkpoints WHERE thread_id LIKE '<task_id>:%' GROUP BY thread_id"
# 应看到 thread_id 格式正确，rows > 0 表示 checkpoint 被持久化
```
```

---

## 5. 全局禁忌与防事故

- ❌ 不 `git push origin main`
- ❌ 不 `gh pr merge --admin`
- ❌ 不跳 `node --check` 预检（feedback memory brain_deploy_syntax_smoke）
- ❌ 不在 Brain 未 deploy 情况下开 C6（runWorkflow 会报 workflow not found）
- ❌ 不改 harness-initiative / content-pipeline 真接入（留 C8，需图结构重设计）
- ✅ `WORKFLOW_RUNTIME` 默认 `v1` / 未设 → 生产零变化
- ✅ 崩溃 resume manual smoke 合前必跑
- ✅ /dev 全流程 cp-* 分支 + PR + CI

---

## 6. 参考资料

- **原 spec**：`docs/design/brain-orchestrator-v2.md` §6 + §12（11 决策表）
- **整体 roadmap**：`docs/design/brain-v2-roadmap-next.md`
- **Memory 进度**：`~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/brain-orchestrator-v2.md`
- **Memory changelog**：`~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/changelog.md`（2026-04-23/24 条目）
- **本 turn PR 列表**：#2560 / #2568 / #2572-#2574 / #2579 / #2581-#2583 / #2585-#2588（14 个）

---

## 7. 一眼 checklist（新会话按顺序打勾）

- [ ] Step 1-2 读 doc + 查 main HEAD/容器状态
- [ ] Step 3 `bash scripts/brain-deploy.sh` Brain redeploy
- [ ] Deploy 验证（workflows/ 入 image + migration 244 + initializeWorkflows 启动 log）
- [ ] 注册 Brain task（POST /api/brain/tasks，PRD 从 §4 贴）
- [ ] `/dev --task-id <id>` 开工 C6
- [ ] 分别跑 tick 单测 + 默认/env=v2 两场景
- [ ] push + PR + auto-merge + 等 CI 绿
- [ ] 合并后手动 set `WORKFLOW_RUNTIME=v2` 重启 Brain 跑 manual smoke
- [ ] 崩溃 resume 验证成功 → 回写 Brain task + 更新 memory changelog
- [ ] 观察 24h 无生产回退 → 可开 C7 清 shim

---

**本 handoff 冻结**：2026-04-24 15:45 UTC。
