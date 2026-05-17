# Learning — Deploy Webhook repo-mount 修复（2026-05-05）

分支：cp-0505120921-deploy-webhook-repo-mount
版本：Brain 1.228.0

## 故障

`brain-ci-deploy.yml` CI 跑 `POST /api/brain/deploy` 后 Brain 立即回 `status=failed`，
错误：`deploy-local.sh exited code=127 signal=null`。

- `code=127` = bash 找不到文件（`No such file or directory`）
- Brain 容器在 `/app` 运行，`scripts/deploy-local.sh` 解析路径为 `/scripts/deploy-local.sh`（容器内不存在）
- `ops.js` 用 `new URL('../../../../scripts/deploy-local.sh', import.meta.url).pathname`，
  在容器内 `import.meta.url = file:///app/src/routes/ops.js`，四层 `..` 到达根目录 `/`，
  得到 `/scripts/deploy-local.sh`

## 根本原因

Deploy 设计上是"Brain 触发宿主部署"，但：
1. `Dockerfile` 只 COPY `packages/brain/` 到 `/app`，`scripts/` 目录不在镜像里
2. `docker-compose.yml` 只挂了 `.git:ro`（用于 harness-worktree clone），没挂 `scripts/`
3. `REPO_ROOT` 没有 env var 覆盖，只靠 `import.meta.url` 相对路径推算（容器内路径不对）

问题在 Brain 容器化之初就存在；每次 CI 触发都失败，但之前 DEPLOY_TOKEN 过期导致 401，
401 在更早就失败，从未走到 code=127 这一层。本次更新 DEPLOY_TOKEN 后才暴露。

## 修复

### 修复 1 — `ops.js` REPO_ROOT 环境变量
所有 `const repoRoot = new URL('../../../..', import.meta.url).pathname` 替换为：
```js
const repoRoot = process.env.REPO_ROOT || new URL('../../../..', import.meta.url).pathname;
```
同理 `stagingScript` 和 `scriptDir` 改为 `${repoRoot}/scripts/...` 字符串拼接。

### 修复 2 — `docker-compose.yml`：挂载主仓库 + REPO_ROOT env
- 替换 `.git:ro` 为全仓库挂载：`/Users/administrator/perfect21/cecelia:rw`
  - Brain 需要 `git pull`、`git tag` 写 `.git/`，只读不够
  - `scripts/` 目录在仓库根，必须挂载才能执行
- 新增环境变量：`REPO_ROOT=/Users/administrator/perfect21/cecelia`
  - 让 Brain 容器内 `process.env.REPO_ROOT` 直接得到正确的宿主路径

## 下次预防

- [ ] `scripts/` 和主仓库根未在容器内挂载 = deploy webhook 必失败。新建 docker-compose.yml 时，
  若有任何 `scripts/` 引用，必须同步检查卷挂载配置
- [ ] `ops.js` 中任何硬编码 `import.meta.url` 路径推算均假设容器路径 = 源码路径，容器化时必失败
  — 统一改为 `process.env.REPO_ROOT || fallback` 模式
- [ ] 修复 DEPLOY_TOKEN 时同步验证整条链路（不只是 401→202，还要看 deploy status 是否 success）
