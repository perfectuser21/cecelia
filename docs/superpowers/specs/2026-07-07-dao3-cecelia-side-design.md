# 设计：staging unknown 线显式策略 + relay env 注入宿主 worktree 路径

> harness 跨 repo 化刀3 的 cecelia 半件。Brain task 689329f5，decision 2d406be7。
> 交接：docs/handoffs/202607072249-harness-crossrepo-dao34.md 3a/3b 节。

## 改动 1：staging unknown 线不跑 deploy（packages/brain/src/staging-e2e-runner.js）

**问题**：`resolveLine(baseRepo)` 对非 cecelia/zenithjoy repo 返回 'unknown'；`deployStaging` 的分支里
unknown 落进最终 else，跑 `scripts/staging-deploy.sh` 把 **cecelia brain** 部署到 :5222——对第三方 repo 是错误目标。

**修法**（只动 staging-e2e-runner.js，staging-promote.js 不动）：
1. `runStagingE2E` 在 `const line = resolveLine(baseRepo)` 之后、抢 advisory lock 之前，加 unknown 早退分支：
   - 不抢锁、不跑任何 deploy；
   - `finalize('SKIP', 'unknown_line', {}, { promoteStatus: PENDING_PROMOTE, notifyMessage: ... })`。
2. `finalize` 增加第 4 参 `o = {}`：`o.promoteStatus` 存在时，跳过 `handlePromote`，改为
   `updatePromoteStatus(dbPool, prUrl, o.promoteStatus)` + best-effort 飞书通知（`opts.notify || sendFeishu`），
   其余（recordResult / writeTaskResult / updateTaskStatus completed）不变。
3. 通知文案与现有 pending_promote 分支同风格：说明第三方 repo 无 staging 部署目标、已挂 pending、
   confirm 回流接口路径。

**语义**：
- verdict=SKIP（DB CHECK 只允许 PASS/FAIL/SKIP；unknown="staging 验证没跑"，与 SKIP 语义一致）
- reason='unknown_line'
- promote_status='pending_promote'（进人工决策队列；promote 回流侧 unknown 已是安全路径，不动）
- cecelia（internal）/ zenithjoy（customer）线行为完全不变

## 改动 2：relay spawn env 注入宿主 worktree 路径（packages/brain/src/harness-skill-relay.js）

**问题**：worktreePath 只进 docker mount（容器内 /workspace），env 无宿主路径。controller（容器内）
Step 5 切 curl judge API 后，worktree 参数必须传宿主绝对路径（Brain 容器把 ~/perfect21/cecelia 与
.claude/worktrees 按宿主同路径挂载，已核实 docker inspect）。

**修法**：spawn env 块加一行 `HARNESS_WORKTREE_HOST: worktreePath`。纯增量，现有键不动。

## 测试策略（unit 档，repo 既有模式：vitest + mock pool/deploy/notify）

- `staging-e2e-runner.test.js` 新增：
  1. [BEHAVIOR] base_repo=第三方 repo → deploy mock **零调用**，verdict=SKIP reason=unknown_line，
     promote_status 落 pending_promote，notify 调用一次（文案含 pending）
  2. [BEHAVIOR] 既有 internal/customer 用例不红（回归保障）
- `harness-skill-relay.test.js` 新增：
  3. [BEHAVIOR] spawnFn 收到的 env.HARNESS_WORKTREE_HOST === ensureWt 返回的 worktreePath

哨兵定性：两处均为**逻辑接缝**（分支判断 + env 拼装），CI unit test 即守卫，无环境接缝，不加运行时自检。

## 不做
- staging-promote.js（decidePromote/promote 回流）不动
- controller SKILL.md 切 curl（zenithjoy-skills 侧，另一 PR）
- LangGraph 死代码删除（刀4）
