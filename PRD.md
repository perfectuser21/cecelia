# PRD: Gate 3 + Gate 2 — Brain CI Auto Deploy & Revert

## 目标

新建 `.github/workflows/brain-deploy.yml`，实现：
- Gate 3：push to main 有 brain 变更时自动 SSH deploy
- Gate 2：deploy/smoke 失败时自动创建 revert PR + Brain P0 告警任务

## 成功标准

- [x] `.github/workflows/brain-deploy.yml` 文件存在
- [x] 使用 `dorny/paths-filter@v3` 检测 `packages/brain/**` 和 `scripts/brain-deploy.sh` 变更
- [x] `deploy-brain` job 用 SSH 连到 38.23.47.81，执行 git pull + brain-deploy.sh
- [x] post-deploy smoke 验证 HTTP 200 且响应含 `"status":"ok"`
- [x] `on-deploy-failure` job 在 deploy-brain 失败时执行
- [x] 自动 git revert HEAD --no-edit 并 push 到 `revert-brain-YYYYMMDDHHMM` 分支
- [x] gh pr create 创建标题含 `[AUTO-REVERT]` 的 PR
- [x] curl Brain API 创建 P0 告警任务
- [x] workflow 超时 10 分钟

## DoD

- [x] [ARTIFACT] `.github/workflows/brain-deploy.yml` 存在
  Test: `manual:node -e "require('fs').accessSync('.github/workflows/brain-deploy.yml')"`

- [x] [BEHAVIOR] workflow 使用 dorny/paths-filter@v3 检测 brain 路径
  Test: `manual:bash -c "grep -q 'dorny/paths-filter@v3' .github/workflows/brain-deploy.yml && grep -q 'packages/brain' .github/workflows/brain-deploy.yml"`

- [x] [BEHAVIOR] deploy-brain job 用 appleboy/ssh-action SSH 连接并执行 brain-deploy.sh
  Test: `manual:bash -c "grep -q 'appleboy/ssh-action' .github/workflows/brain-deploy.yml && grep -q 'brain-deploy.sh' .github/workflows/brain-deploy.yml"`

- [x] [BEHAVIOR] post-deploy smoke 验证 HTTP 200 + "status":"ok"
  Test: `manual:bash -c "grep -q 'status.*ok' .github/workflows/brain-deploy.yml"`

- [x] [BEHAVIOR] on-deploy-failure job 在失败时创建 [AUTO-REVERT] PR
  Test: `manual:bash -c "grep -q 'AUTO-REVERT' .github/workflows/brain-deploy.yml && grep -q 'git revert' .github/workflows/brain-deploy.yml"`

- [x] [BEHAVIOR] on-deploy-failure 创建 Brain P0 告警任务
  Test: `manual:bash -c "grep -q '/api/brain/tasks' .github/workflows/brain-deploy.yml"`
