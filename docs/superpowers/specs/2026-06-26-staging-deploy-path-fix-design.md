# staging-e2e-runner 部署脚本相对路径修复设计（2026-06-26）

## Bug
`packages/brain/src/staging-e2e-runner.js:27` `DEFAULT_DEPLOY_SCRIPT = 'scripts/staging-deploy.sh'`（相对路径）。
staging-e2e-runner 跑在生产 brain 容器 cecelia-node-brain（WORKDIR=/app），相对路径解析到 /app/scripts/（镜像没 COPY repo 根 scripts/）→ `bash: scripts/staging-deploy.sh: No such file or directory` → staging E2E verdict=FAIL reason=deploy_failed。脚本实际在 bind-mount 的 `/Users/administrator/perfect21/cecelia/scripts/`。

## 根因 + explore 关键发现
- 相对路径 + 容器 cwd=/app，脚本在 bind-mount repo 根 scripts/，两者对不上。
- **审核推翻 Agent B 误判**：生产 brain 容器有 `/var/run/docker.sock` + repo bind-mount + 容器内 `docker ps` 连 host daemon + `.env.staging`/`docker-compose.staging.yml` 可见 → 路径修对即可真部署，**不需改 docker-compose.staging.yml**。
- **审核推翻 Agent B 的 getRepoRoot 方案**：`getRepoRoot()`（staging-promote.js:174）用 `import.meta.url` 算路径，容器内代码在镜像层 /app/src → `path.resolve('/app/src','../../..')` = `/`（实测确认 `getRepoRoot()=/`）。用它会拿到 `/scripts/staging-deploy.sh`，仍然找不到。
- **正确源**：brain 容器有 env `REPO_ROOT=/Users/administrator/perfect21/cecelia`（= bind-mount 的 repo 根），实测存在。

## 方案对比
| 方案 | 做法 | 取舍 |
|---|---|---|
| **A（选）** | `process.env.REPO_ROOT \|\| getRepoRoot()` 拼绝对路径 + cwd | 容器用 REPO_ROOT env✅；本地直跑/测试 fallback getRepoRoot()（import.meta.url 本地对）✅ |
| B | 单纯 getRepoRoot() | 容器内返回 `/`，错（实测） |
| C | executor 调用处传 cwd | 治标，DEFAULT_DEPLOY_SCRIPT 仍相对，别的调用方仍踩 |
| D | 改 docker-compose.staging.yml 挂载 | 审核排除（socket+repo 已齐，多余） |

## 设计（方案 A）
`staging-e2e-runner.js` `deployStaging(opts)` 内统一解析 repoRoot 并拼绝对路径：
```js
// import path 已在文件顶部（或新增）
const repoRoot = opts.cwd || process.env.REPO_ROOT || getRepoRoot();
const script = opts.deployScript || path.join(repoRoot, 'scripts/staging-deploy.sh');
const raw = exec(`bash ${script}`, { cwd: repoRoot, ... });
```
- 优先级：opts.cwd（测试注入）> process.env.REPO_ROOT（容器，= bind-mount repo 根）> getRepoRoot()（本地直跑兜底）
- cwd 同时设为 repoRoot，保证 staging-deploy.sh 内 `$ROOT_DIR`（= SCRIPT_DIR/..）解析到 repo 根，能读到 .env.staging / docker-compose.staging.yml。

## 测试策略：unit（逻辑接缝）
`staging-e2e-runner` 单测（注入 mock exec）：
- 传 opts.deployScript 绝对路径 + opts.cwd → exec 收到该绝对路径 + cwd
- 不传 opts、设 process.env.REPO_ROOT=/fake/repo → exec 收到 `/fake/repo/scripts/staging-deploy.sh` + cwd=/fake/repo
- exec 返回 STAGING_SKIP_REASON=no_docker → 解析为 skipped（不回归现有降级行为）

## 不包含（YAGNI / 审核排除）
- docker-compose.staging.yml 改动（审核确认 socket+repo 已齐，不需要）
- Bug2 死线程短路逻辑（审核证明非真 bug：告警仅 1 次=fresh-start 误报，walking_skeleton 无持久冗余，PR 真 merged 秒回是 langgraph 正确行为）
