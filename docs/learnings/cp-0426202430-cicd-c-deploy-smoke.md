# Learning: cicd-C — brain-deploy.sh post-deploy smoke

分支: cp-0426202430-cicd-c-deploy-smoke
日期: 2026-04-26
作者: cicd-C (team cecelia-cicd-foundation)

## 背景

`scripts/brain-deploy.sh` 部署完只 curl `/api/brain/tick/status` 看 200，
不验业务功能在生产环境真生效。例如：
- 2026-04-24 brain-deploy 后 server.js merge-resolve 级 SyntaxError 漏（
  feedback_brain_deploy_syntax_smoke.md），CI lint 过、deploy 不真启动。
- LangGraph PostgresSaver migration 244 跑挂时只能等下一次实际 task 派发才发现。

需要一层「合并的 PR 引入了什么 smoke，部署完就跑什么」的轻量门禁，
真 docker / 真 pg / 真 Brain 重启验证。

## 根本原因

1. **健康检查是必要不充分条件**：tick/status 200 只代表 Express 路由能挂，
   不能证明 LangGraph / Postgres / docker / 业务路径全 OK。
2. **smoke 没有强制运行点**：之前每次写 smoke.sh 全靠人记得跑，没强制点。
3. **deploy 后没有「最近 PR 引入的契约要兑现」机制**：smoke 应当跟 PR 走，
   PR 引入哪个 smoke，部署完就该跑哪个，否则 smoke 沉淀不下来。

## 解决方案

1. `scripts/brain-deploy.sh` 加 `run_post_deploy_smoke()` 函数 + Phase 11 调用：
   - 读 `gh pr list --state merged --limit 5` 取近 5 PR
   - 每 PR `gh pr view --json files` 找 `packages/brain/scripts/smoke/*.sh`
   - 同 smoke 多 PR 都改过时去重（mktemp seen_file）
   - 单条 non-fatal — deploy 已 healthy 不能因 smoke 回滚
   - 提供 `SKIP_POST_DEPLOY_SMOKE=1` 紧急开关 + `RECENT_PRS="X Y"` mock 用

2. 1 个 smoke 范本 `packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh`：
   - 检测 docker / 容器 / psql / DATABASE_URL 全可达，否则 SKIP exit 0
   - 唯一 thread_id 防并发污染
   - docker exec brain node 调 PostgresSaver.put 5 次（模拟 5 节点）
   - psql 验 checkpoints 表 ≥ 5 行
   - docker restart cecelia-node-brain + 等 healthy
   - 重启后 psql 再数行数（DB 持久 OK）
   - docker exec brain node 调 saver.getTuple 验 5 channel 全恢复
   - trap EXIT cleanup（删 thread_id 对应的 checkpoint* 全部行）

3. 单测 `packages/brain/src/__tests__/post-deploy-smoke.test.js`：纯文件不变量校验，
   保 brain-deploy.sh 含 `run_post_deploy_smoke` 函数 + smoke 范本含 7 步关键 grep。

## 验证步骤（已跑通）

1. ✅ `bash packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh` 真过 PASS
   （5 PUT → 5 行 → docker restart → 仍 5 行 → getTuple 5 channel 全恢复 → cleanup）
2. ✅ Mock `RECENT_PRS=9999` + 抠 `run_post_deploy_smoke` 函数单跑 → 走本地 smoke 目录
   fallback → 跑通 c8a smoke → ran=1 failed=0
3. ✅ Mock 故意失败 smoke → ❌ 但函数 exit 0（non-fatal）
4. ✅ `SKIP_POST_DEPLOY_SMOKE=1` → 立即 [skip] 退出
5. ✅ 屏蔽 gh + 不传 RECENT_PRS → [skip] gh CLI 不存在
6. ✅ vitest 5 tests passed

## 下次预防

- [ ] **每个新 contract 都该带 1 个 smoke**：PR 改了 brain v2 / langgraph / pipeline /
  observer 等核心模块，必须在 `packages/brain/scripts/smoke/` 加 1 个真实环境验证脚本
  （不是单元测试 mock）。task A 的 SKILL 强制 + task B 的 CI lint 会把这个变成强制门。
- [ ] **smoke 必须可重入 + 自清理**：不留垃圾行（trap EXIT delete by thread_id）。
  下次审 smoke 脚本时第一眼看是否有 trap cleanup EXIT。
- [ ] **smoke 必须能优雅 skip**：缺 docker / 容器 / psql 时 exit 0，否则会卡死本地 dev。
- [ ] **gh pr view 在 mock 模式 fallback 扫本地**：brain-deploy.sh 的
  `run_post_deploy_smoke` 在 RECENT_PRS 设了但 gh 拿不到 files 时，扫
  `$ROOT_DIR/packages/brain/scripts/smoke/` 兜底，方便测试 + 灾难恢复模式
  （断网部署时也能跑 smoke）。
