# orchestrator 远程化分支 — 终审全量修复报告

分支：`cp-09131145-orchestrator-remote-launch`
关联决策：2e756506（orchestrator 远程化方案B）、a9773a84（DB 通路）

## C1（Critical）orchestrator 槽位只借不还

**文件**：`packages/brain/scripts/fleet-worker/orchestrator-runner.cjs`（`start()`）

**问题**：spawn 成功后没有挂 exit 钩子，`terminal()` 又零调用方，job 永停 `running`，
`active()` 恒占坑，第 3 个 prepare 起撞 `orchestrator_slots_exhausted`。

**修法**：spawn 成功（pid 校验通过）后立刻挂：

```js
child.once('exit', (code) => {
  job.status = code === 0 ? 'done' : 'failed';
});
```

detached + unref 下，只要父进程（fleet-worker）存活，`exit` 事件仍会送达，槽位随子进程
退出自动释放，不再依赖 `terminal()` 端点。

**测试**：`orchestrator-runner.test.cjs`
- `C1：exit 钩子释放槽位——进程退出后第 3 个 prepare 不再撞 slots_exhausted`
- `C1：非 0 退出码 → job 置 failed（同样释放槽位）`

## C2（Critical）spawn 'error' 无监听会带崩 fleet-worker

**文件**：同上，`start()`

**问题**：detached spawn 的异步 ENOENT/EACCES 走 `error` 事件，无监听 = uncaughtException =
整个 fleet-worker 进程崩溃（连坐所有 attempt）。

**修法**：参照本仓先例 `packages/brain/src/harness-skill-relay.js` 的监听手法，spawn 后立刻
挂 `error` 监听（在同步 pid 检查之前，因为 error 事件可能在下一个 tick 就到）：

```js
child.once('error', (err) => {
  job.status = 'failed';
  console.error(`[orchestrator-runner] spawn_error run=${runId}: ${err?.message}`);
});
```

同步 pid 检查（`Number.isInteger(child.pid)`）保留不变。

**测试**：`orchestrator-runner.test.cjs` → `C2：spawn 触发 error 事件 → job 置 failed，不抛顶层异常`

## I1（Important）部署文档 env 落错机器

**文件**：`docs/superpowers/plans/2026-09-13-orchestrator-remote-launch.md`（部署段步骤 2/3）

**问题**：orchestrator 搬到 MMV 后，它是 orchestrator-runner.cjs `spawn(..., {env:{...process.env}})`
拉起的子进程，读的是**自己进程的 env**（即 MMV fleet-worker 的 launchd env，经透传），
不是 us-vps Brain 的 env。它内部经 `production-transport.js` 回连三台 worker 派 attempt、
回调 Brain 写终态，所以 `FLEET_WORKER_*_URL` / `KERNEL_FLEET_BRIDGE_TOKEN` /
`KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL` 必须配在 **MMV worker 的 launchd env**，
不能只在 us-vps Brain compose 里配。

**修法**：
- 步骤 2 补充三类 env 清单（`FLEET_WORKER_US_MAC_M4_URL` / `FLEET_WORKER_XIAN_MAC_M4_URL` /
  `FLEET_WORKER_XIAN_MAC_M1_URL`、`KERNEL_FLEET_BRIDGE_TOKEN`、
  `KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL`）
- 步骤 3 保留 us-vps 侧配置，注明「Brain 本机 fallback 用；对远程 orchestrator 生效的是
  步骤 2 的 worker env，两处应同值但物理落点不同」

无代码改动，无测试。

## 顺手项

1. **`inspect()`/`terminal()` UUID 校验**：非法 `run_id` → 400 `orchestrator_run_id_invalid`，
   与 `prepare()` 同型（之前非法 id 走 404 `orchestrator_not_found`，语义不准）。
   测试：`inspect/terminal：非法 run_id → 400 orchestrator_run_id_invalid`

2. **`terminal()` 注释**：标注为预留端点，当前无生产调用方（Brain 侧将来终态回执用），
   槽位释放已由 exit 钩子承担，本端点不再是槽位释放的唯一路径。

3. **`orchestrator-remote-bridge.js`**：2xx 但 `response.json()` 解析失败不再静默吞成 `null`，
   改为 `throw new Error('orchestrator_bridge_<op>_invalid_json:...')`。非 2xx 分支的
   json 解析失败仍保持原有容错（错误体未必是 json）。
   测试：`orchestrator-remote-bridge.test.js` → `2xx 但 response.json() 解析失败 → 不静默 null，抛 invalid_json`

## 测试结果

```
cd packages/brain && npx vitest run scripts/fleet-worker/ src/__tests__/orchestrator-remote-bridge.test.js
```

```
 ✓ scripts/fleet-worker/attempt-runner.test.cjs  (122 tests)
 ✓ scripts/fleet-worker/fleet-worker.test.js  (61 tests)
 ✓ scripts/fleet-worker/workspace-manager.test.cjs  (19 tests)
 ✓ scripts/fleet-worker/attempt-resources.test.cjs  (7 tests)
 ✓ scripts/fleet-worker/orchestrator-runner.test.cjs  (10 tests)
 ✓ scripts/fleet-worker/credential-envelope.test.cjs  (11 tests)
 ✓ scripts/fleet-worker/github-credential-envelope.test.cjs  (2 tests)
 ✓ src/__tests__/orchestrator-remote-bridge.test.js  (5 tests)

 Test Files  8 passed (8)
      Tests  237 passed (237)
```

```
bash scripts/ci/__tests__/machine-registry-role-guard.test.sh
```

```
== machine-registry 角色守卫 ==
  ✅ 恰好一台 primary（1）
  ✅ orchestrator/production-transport.js 命中数 2（登记 2）
  ✅ harness-skill-relay.js 命中数 1（登记 1）
  ✅ orchestrator/fleet-node/node-profile.js 命中数 3（登记 3）
  ✅ orchestrator/fleet-node/node-admission-client.js 命中数 1（登记 1）

✅ machine-registry role guard OK
```

## DevGate

```
node scripts/facts-check.mjs            → All facts consistent. ✅
bash scripts/check-version-sync.sh      → All version files in sync ✅
node packages/quality/scripts/devgate/check-dod-mapping.cjs → 映射检查通过 (3 项) ✅
```
