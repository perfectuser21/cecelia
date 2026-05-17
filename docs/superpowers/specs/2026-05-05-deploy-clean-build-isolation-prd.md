# PRD: Deploy Clean Build Isolation + 失败可调试

## 背景

PR #2787 deploy fail 实战暴露 deploy 链路 3 个隐藏 bug 叠加：

1. **Docker build 用本地工作树** — 任何未 commit 的 `package.json` 修改都污染 image build
2. **`deploy-webhook` 用 `stdio: 'ignore'`** — 失败原因彻底丢失，运维只能看到 "deploy-local.sh exited code=1"
3. **多 session 并行编辑同文件** — 一个 session 升级 pg 但没收尾，恰好赶上另一个 session 触发 deploy

实战触发：
- 18:43 某 session 改 `packages/brain/package.json`：pg `^8.12.0` → `^8.20.0`，未 commit / 未更新 lock
- 21:45 PR #2787 merged → deploy-webhook → `docker build cwd` 把脏工作树打进 image
- 21:46 npm ci fail：`lock file's pg@8.19.0 does not satisfy pg@8.20.0`
- 但 stdio:'ignore' → 状态文件只有 `"error":"deploy-local.sh exited code=1"`，npm error 全丢

## 目标

让 deploy 链路对脏工作树**完全免疫** + 失败原因**始终可调试**。L1+L2 同时修，避免下次再栽。

## 范围

**改**：
- `scripts/brain-build.sh` — Docker build 改用 `git archive HEAD` 输出到临时 dir，从临时 dir 构建（脏工作树彻底隔离）
- `packages/brain/src/routes/ops.js` — deploy-webhook spawn 改 `stdio: ['ignore', logFd, logFd]`，输出写到 `/tmp/cecelia-deploy-${ts}.log`，状态文件加 `log_path` 字段

**不改**：
- `deploy-local.sh` 主流程
- `brain-deploy.sh` 7 步流程
- pg 版本本身（用户后续单独决定 revert / commit / 让另一个 session 收尾）

## 改动设计

### 1. brain-build.sh — git archive 隔离

```bash
# 旧
docker build -t "cecelia-brain:${VERSION}" \
  -f "$ROOT_DIR/packages/brain/Dockerfile" \
  "$ROOT_DIR"

# 新
TEMP_BUILD=$(mktemp -d -t cecelia-brain-build-XXXXX)
trap "rm -rf '$TEMP_BUILD'" EXIT
git -C "$ROOT_DIR" archive --format=tar HEAD | tar -x -C "$TEMP_BUILD"
docker build -t "cecelia-brain:${VERSION}" \
  -f "$TEMP_BUILD/packages/brain/Dockerfile" \
  "$TEMP_BUILD"
```

效果：
- `git archive HEAD` 只导出 git index 跟 HEAD commit 的文件（不含未 commit 改动 / 不含未 track 文件）
- Docker build 上下文是 git HEAD 快照，不依赖 cwd 工作树
- 任何脏工作树修改对 deploy 无影响

### 2. ops.js — deploy-webhook log 落盘

```javascript
// 旧
const child = spawn(args[0], args.slice(1), {
  detached: true,
  stdio: 'ignore',
  cwd: repoRoot,
});

// 新
const logTimestamp = Date.now();
const logFile = `/tmp/cecelia-deploy-${logTimestamp}.log`;
const fs = await import('node:fs');
const logFd = fs.openSync(logFile, 'a');
const child = spawn(args[0], args.slice(1), {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  cwd: repoRoot,
});
fs.closeSync(logFd);
deployState.log_path = logFile;  // 存到状态供查询
```

效果：
- deploy-local.sh 全部 stdout/stderr 写到 `/tmp/cecelia-deploy-<ts>.log`
- `GET /api/brain/deploy/status` 返回 `log_path` 字段
- 失败时立即知道去哪看 npm error

## 成功标准

- [BEHAVIOR] **脏工作树免疫**：主工作树有未 commit 的 `package.json` 修改，brain-build.sh 不会把它打进 image
  - Test: `manual:bash`（脚本：建临时 git repo + 改工作树 + 跑 brain-build 关键段，验证 image 内文件 = git HEAD 不是脏工作树）
- [BEHAVIOR] **deploy log 落盘**：deploy-webhook 触发后 `/tmp/cecelia-deploy-<ts>.log` 存在并含 deploy-local.sh 输出
  - Test: `tests/integration/deploy-webhook-log.test.sh`
- [BEHAVIOR] **status API 返回 log_path**：`GET /api/brain/deploy/status` 失败状态含 `log_path` 字段指向真实文件
  - Test: 同上
- [ARTIFACT] `brain-build.sh` 含 `git archive` 关键字
  - Test: `manual:node -e "..."`
- [ARTIFACT] `ops.js` 不再含 `stdio: 'ignore'` 在 deploy spawn 段
  - Test: `manual:node -e "..."`
- [ARTIFACT] `ops.js` deploy spawn 段含 `log_path` 写入
  - Test: `manual:node -e "..."`

## Out of scope

- 不修 pg 版本本身（用户决定）
- 不改 deploy-local.sh / brain-deploy.sh（独立 followup）
- 不引入 staging 环境隔离（更大范围工作）
