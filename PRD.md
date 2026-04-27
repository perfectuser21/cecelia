# PRD: Gate 3 + Gate 2 — Brain HTTP 自动部署

## 问题

brain-deploy.yml（SSH 方案）已撤销。main 上 brain 代码变更后无自动部署机制。

## 成功标准

## 成功标准
- **[ARTIFACT]** `.github/workflows/brain-ci-deploy.yml` 存在
- **[ARTIFACT]** `packages/brain/scripts/smoke/gate3-gate2-smoke.sh` 存在
- **[BEHAVIOR]** workflow 触发条件：`push: main, paths: packages/brain/**`
- **[BEHAVIOR]** concurrency group 为 `brain-autodeploy`（非 `deploy-production`）
- **[BEHAVIOR]** on_failure job 创建 Brain P0 任务

## DoD

- [x] [ARTIFACT] `.github/workflows/brain-ci-deploy.yml` 文件存在
      Test: manual:node -e "require('fs').accessSync('.github/workflows/brain-ci-deploy.yml')"
- [x] [ARTIFACT] smoke 脚本存在
      Test: manual:node -e "require('fs').accessSync('packages/brain/scripts/smoke/gate3-gate2-smoke.sh')"
- [x] [BEHAVIOR] workflow 使用 push trigger + brain paths
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/brain-ci-deploy.yml','utf8');if(!c.includes('packages/brain/**'))process.exit(1)"
- [x] [BEHAVIOR] concurrency group 为 brain-autodeploy，与 deploy-production 隔离
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/brain-ci-deploy.yml','utf8');if(!c.includes('brain-autodeploy'))process.exit(1)"
- [x] [BEHAVIOR] Gate 2 失败时创建 Brain P0 任务
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/brain-ci-deploy.yml','utf8');if(!c.includes('api/brain/tasks'))process.exit(1)"
- [x] [BEHAVIOR] 409 响应被视为 skip（非失败）
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/brain-ci-deploy.yml','utf8');if(!c.includes('409'))process.exit(1)"
