# Design: kernel 落盘日志跨部署持久化 + 清理策略

## 背景

PR #4721(刀0)让 kernel 子进程 stdout/stderr 落盘，默认目录 `/tmp/cecelia-kernel-logs`。该路径落在 Brain 容器 100MB tmpfs（docker-compose.yml `tmpfs: - /tmp:size=100M`），未 bind-mount。生产实测：`docker exec cecelia-node-brain ls /tmp/cecelia-kernel-logs` → `No such file or directory`。Brain 每次部署重建容器即清空该目录，而"诊断 planner 停摆"这个场景本来就必然伴随一次重新部署——刀0想解决的"零观测"问题在最需要看日志的那一刻反而失效。

`ops.js:2857-2870`（deploy-webhook 部署日志）已踩过同一个坑并修好：日志写到 `REPO_ROOT/logs/`，`REPO_ROOT` 对应的目录在 docker-compose.yml 里是整仓库 bind-mount rw，容器重建不受影响。本设计照抄这个已验证的模式。

## 关键实测（本次新增，PRD 原文未覆盖到这一步）

1. `process.env.REPO_ROOT` 在生产容器里实测 = `/Users/administrator/perfect21/cecelia-deploy-main`（`docker exec cecelia-node-brain node -e "console.log(process.env.REPO_ROOT)"`），确认走的是 CD 部署根，非开发 checkout，且该路径确认 bind-mount rw。
2. **相对路径层级不能照抄 ops.js**：`ops.js` 在 `packages/brain/src/routes/ops.js`（4 层深），用 `new URL('../../../..', import.meta.url)` 能算对到 repo 根；`harness-skill-relay.js` 在 `packages/brain/src/harness-skill-relay.js`（3 层深，少一层 `routes/`），若照抄 4 级会算到 repo **外面**（`/Users/administrator/perfect21/`，docker-compose 未挂载此路径）。已用真实 node 脚本验证：
   ```
   ops.js ../../../.. => /Users/administrator/perfect21/cecelia/          ✅
   harness-skill-relay.js ../../../.. => /Users/administrator/perfect21/  ❌ 出了 repo
   harness-skill-relay.js ../../..   => /Users/administrator/perfect21/cecelia/  ✅ 正确层级
   ```
   生产环境因为 `REPO_ROOT` env 已设置，`||` 兜底从不触发，这个错误不会在生产暴露；但单测直接 import 源码会走到兜底分支，层级算错会让测试断言到错误路径且埋下隐患（未来任何一次 REPO_ROOT 环境变量意外缺失，就会在生产复现）。

## 架构：三处独立改动

### 1. 落盘路径 — `harness-skill-relay.js:138`

```js
// 改前
const logDir = process.env.CECELIA_KERNEL_LOG_DIR || '/tmp/cecelia-kernel-logs';

// 改后
const logDir = process.env.CECELIA_KERNEL_LOG_DIR
  || join(process.env.REPO_ROOT || new URL('../../..', import.meta.url).pathname, 'logs', 'kernel');
```

不新建共享 `resolveRepoRoot()` util——`ops.js` 自己内部就是 4 处内联重复同一行（未抽函数），跟随现有代码惯例，不做无关重构。

### 2. 新模块 — `packages/brain/src/cron/kernel-log-cleanup.js`

```js
export const KERNEL_LOG_TTL_MS = parseInt(process.env.CECELIA_KERNEL_LOG_TTL_MS || String(7 * 24 * 60 * 60 * 1000), 10)

export function cleanOldKernelLogs(logDir, ttlMs = KERNEL_LOG_TTL_MS, nowMs = Date.now()) {
  // readdirSync → statSync → mtime 超 ttlMs 的 unlinkSync
  // 目录不存在 / 读取失败 → 静默返回 { scanned: 0, removed: 0 }，不抛
}
```

纯 fs 操作，TTL 默认 7 天（PRD 偏好方案，`CECELIA_KERNEL_LOG_TTL_MS` 可覆盖），不依赖 `initiative_runs` 生命周期（PRD 的另一选项，未采用，理由同 PRD：更简单、和 disk-guard 现有"周期扫描"模型一致）。

### 3. 挂进 disk-guard.js

在 `runDiskGuard()` 现有 INV-04 清理序列（`docker container prune → builder prune → worktree_reaper → npm/brew cache`）末尾追加一步，通过 `deps.cleanOldKernelLogs` 注入（跟 `deps.runWorktreeReaper` 同款依赖注入写法，无需新增独立 cron，复用已有 15 分钟周期）。

## 错误处理

三处改动全部延续现有代码的"降级不阻断"哲学：
- 日志目录建不了 → 退回 `stdio:'ignore'`（已有逻辑，不改）
- 清理失败 → catch 打 warn，不抛，不阻断 disk-guard 其余步骤
- 新步骤跟 disk-guard 里其他清理步骤一样 `.catch(e => console.warn(...))` 包裹

## 测试计划（TDD，commit-1 全部先写成失败）

1. `harness-kernel-launch.test.js` 新增一条：不设 `CECELIA_KERNEL_LOG_DIR` 时，测试内设置临时 `REPO_ROOT` 指向临时目录，断言 spawn 传入的日志路径落在 `<临时REPO_ROOT>/logs/kernel/` 而非 `/tmp/`。
2. 新文件 `kernel-log-cleanup.test.js`：真实临时目录 + 真实文件 + `utimesSync` 改 mtime，断言超 TTL 的文件被删、阈值内保留——不 mock fs（PRD 明确要求，清理逻辑 mock 文件系统测不出真实 bug）。
3. `disk-guard.test.js` 扩展 `[BEHAVIOR-1]`：INV-04 序列末尾追加 `kernel_log_cleanup`，断言被调用且顺序在 `npm_cache` 之后（或按实现顺序调整，序列断言用真实实现顺序为准）。

测试永久入 CI，不删除。

## 集成验收（哨兵，环境接缝，CI 测不到）

真实触发一次 kernel 进程，跑一次 `brain-deploy.sh` 后，在宿主机验证该日志文件依然存在且内容完整——这是本次修复唯一的存在理由。

## 边界（不做）

- 不碰 stdio 落盘核心机制本身（`['ignore', logFd, logFd]`，已验证是对的）
- 不碰 `orchestrator/run.js`、kernel 状态机、provider adapter
- 不处理 `CECELIA_KERNEL_LOG_PATH` 透传给 kernel 自身这部分死码
- 不重新诊断"planner 停摆"本身
- 不抽取 `resolveRepoRoot()` 共享 util（跟随 ops.js 现有内联重复惯例）
