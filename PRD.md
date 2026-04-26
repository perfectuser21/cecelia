# PRD: cicd-C — brain-deploy.sh post-deploy smoke + c8a smoke 范本

## 背景

当前 `scripts/brain-deploy.sh` 部署完只做 `curl /api/brain/tick/status` 健康检查 ——
只验 Brain 进程能起来，**不验业务功能在生产环境真生效**。最近多次出现：
- merge 级 SyntaxError CI 漏（feedback_brain_deploy_syntax_smoke.md）
- 业务路径在生产 + 真 Postgres 跑挂（例如 LangGraph PostgresSaver 表 missing）

需要一层「合并的 PR 引入了什么 smoke，部署完就跑什么」的轻量门禁。

## 目标

1. `scripts/brain-deploy.sh` 在 healthy check 之后追加 Phase 11 — 自动跑最近 5 个
   合并 PR 引入的 `packages/brain/scripts/smoke/*.sh`，每条 non-fatal。
2. 写 1 个 smoke 范本：`packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh`，
   真 docker exec + 真 Postgres + 真 Brain 重启，验 LangGraph PostgresSaver
   5 节点 / 5 channel 跨进程持久。
3. 范本要可重入、可清理、缺前置依赖时优雅 SKIP exit 0。

## 范围

**改 1 个文件 + 新 1 个文件 + 1 个单测**：

- `scripts/brain-deploy.sh`：在顶部新增 `run_post_deploy_smoke()` 函数；docker /
  launchd healthy 分支末尾调用之；旧 Phase 编号 `[10/10]` 改 `[10/11]`，新增 `[11/11]`。
- `packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh`（新）：7 步真 smoke。
- `packages/brain/src/__tests__/post-deploy-smoke.test.js`（新）：纯文件不变量校验，
  保 deploy.sh 含 `run_post_deploy_smoke` 函数 + smoke 范本含 7 步关键 grep。

## 不做

- 不改 CI workflow（task B 已经覆盖 CI 侧 real-env-smoke job）
- 不改 SKILL（task A 覆盖 /dev 强制 smoke.sh）
- 不写 D / E1 observer / tick / content-pipeline 幂等 smoke（task D 覆盖）
- 不改 dispatcher / brain v2 任何业务代码

## 实现要点

### Phase 11 函数 `run_post_deploy_smoke`
- 读 `gh pr list --state merged --limit 5` 取近 5 PR 号
- 每 PR `gh pr view <pr> --json files --jq '.files[] | select(.path | startswith("packages/brain/scripts/smoke/") and endswith(".sh"))'`
- 同一 smoke 多 PR 都改过时去重（`mktemp seen_file` + grep -qxF）
- env 控制：`SKIP_POST_DEPLOY_SMOKE=1` 整体跳，`RECENT_PRS="X Y"` mock PR 列表
- mock 模式 + 没 gh 时回退扫本地 `packages/brain/scripts/smoke/*.sh`（测试方便）
- 单条 smoke 失败 = `❌` 但**不失败 deploy**（`run_post_deploy_smoke || true`）

### c8a smoke 7 步真实验证
1. 检测 docker / cecelia-node-brain / psql / DATABASE_URL 全可达，否则 SKIP
2. 唯一 thread_id (`smoke-c8a-<utc>-<pid>`) 防并发污染
3. `docker exec cecelia-node-brain node -e "..."` 调 PostgresSaver.put 5 次（5 节点）
4. psql `SELECT count(*) FROM checkpoints WHERE thread_id=...` ≥ 5
5. `docker restart cecelia-node-brain`，等 `/api/brain/tick/status` 200（最多 90s）
6. 重启后 psql 再数行数 ≥ 5（DB 持久 OK）
7. `docker exec ... node -e "saver.getTuple(...)"` 验 5 channel 全恢复
   （worktreePath / plannerOutput / taskPlan / ganResult / result）
8. 第二次 getTuple 仍命中（saver 幂等读语义）
9. trap EXIT cleanup → 删 `checkpoints / checkpoint_blobs / checkpoint_writes`
   对应 thread_id 全部行

## 验收条件 DoD

- [x] [ARTIFACT] `scripts/brain-deploy.sh` 含 `run_post_deploy_smoke` 函数
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.match(/^run_post_deploy_smoke\(\) \{/m))process.exit(1)"

- [x] [BEHAVIOR] `scripts/brain-deploy.sh` Phase 11 调 `run_post_deploy_smoke`
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes('[11/11] Post-deploy smoke')||!c.match(/run_post_deploy_smoke[^\n]*\|\| true/))process.exit(1)"

- [x] [BEHAVIOR] `run_post_deploy_smoke` 支持 SKIP / RECENT_PRS env
  Test: tests/packages/brain/post-deploy-smoke.test.js（同 src/__tests__ 内文件）

- [x] [ARTIFACT] `packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh` 存在 + chmod +x
  Test: manual:node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh');if((s.mode&0o100)===0)process.exit(1)"

- [x] [BEHAVIOR] c8a smoke 含 7 步关键验证（PostgresSaver / 5_channels / docker restart / cleanup）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh','utf8');['PostgresSaver','saver.put','saver.getTuple','5_channels_recovered','docker restart cecelia-node-brain','trap cleanup EXIT','DELETE FROM checkpoints'].forEach(t=>{if(!c.includes(t))process.exit(1)})"

- [x] [BEHAVIOR] c8a smoke 缺前置依赖时优雅 skip exit 0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh','utf8');['docker 命令不存在','docker daemon 不可达','cecelia-node-brain 容器不存在','psql 不在 PATH'].forEach(t=>{if(!c.includes(t))process.exit(1)})"

- [x] [BEHAVIOR] 单元测试全过（vitest）
  Test: tests/packages/brain/post-deploy-smoke.test.js

## 成功标准

- 本机 `bash packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh` 真过 PASS
- 本机 mock RECENT_PRS=9999 跑 `run_post_deploy_smoke` 真过 ✅
- vitest `npx vitest run src/__tests__/post-deploy-smoke.test.js` → 5 tests 5 passed
- CI 全绿
