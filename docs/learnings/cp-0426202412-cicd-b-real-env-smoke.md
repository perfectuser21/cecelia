# Learning — cicd-b-real-env-smoke (2026-04-26)

## 背景

CI 三类测试覆盖各有盲区：
- brain-unit：mock 一切 → 不验真行为
- brain-integration / e2e-smoke：真 postgres + `node server.js` → 不走容器化部署链路
- docker-infra-smoke：build image + 验依赖能 require → 不真启 brain HTTP

**事故**：2026-04-24 brain server.js 出现 merge-resolve 级 SyntaxError（重复 import），
所有 mock-based / lint-based / require-based 检查全绿，只有真启 brain 才会炸 →
事故记录在 `feedback_brain_deploy_syntax_smoke.md`。

## 根本原因

CI 缺少一类测试：**起真容器（不 mock）→ 等 healthy → 跑真 HTTP 请求**。
docker-infra-smoke 的 `node -e "require(...)"` 验依赖装载，但不会触发 module top-level
执行（如 import / express() 调用），所以 SyntaxError / module init 错误溜过去。

## 改动

`real-env-smoke` job：
1. 起 pgvector/pgvector:pg15 service + brain 真容器（`docker run --network host`）
2. 等 90s 内 `curl /api/brain/tick/status` 200 才算 ready
3. 跑 `packages/brain/scripts/smoke/*.sh` 全部，任一失败 → CI fail
4. `packages/brain/scripts/smoke/example-health-check.sh` 范本：curl tick/status 验
   `interval_minutes` / `loop_interval_ms` / `startup_ok` 三个关键字段

## 下次预防

- [ ] 写 brain 业务逻辑 → 配套加 `packages/brain/scripts/smoke/<feature>.sh`，
      让 real-env-smoke 在真容器里替你验一次
- [ ] 修 server.js / src/server.js / 入口模块 → 不能只靠 `node --check`，必须真启
      （docker run + curl tick/status）— real-env-smoke 自动覆盖
- [ ] smoke 写法：用 `BRAIN_URL` 环境变量而非硬编码端口；输出 JSON 体便于排查
- [ ] real-env-smoke 90s 超时阈值不够时（image 慢启动/migrations 慢），
      调整时同步更新本文件

## 相关

- 配套 task A（cicd-A）：/dev SKILL 强制要求 smoke.sh + lint job
- 配套 task C（cicd-C）：brain-deploy.sh post-deploy smoke
- 配套 task D：写 3 个真业务 smoke（observer / tick / content-pipeline）
