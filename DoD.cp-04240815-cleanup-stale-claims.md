# DoD: Brain 启动时清理 stale task claim

**分支**：cp-04240815-cleanup-stale-claims

## Definition of Done

- [x] [ARTIFACT] `packages/brain/src/startup-recovery.js` 新增 `cleanupStaleClaims(pool, opts)` export
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/startup-recovery.js','utf8');if(!c.includes('export async function cleanupStaleClaims'))process.exit(1);if(!c.includes('claimed_by IS NOT NULL'))process.exit(1)"

- [x] [ARTIFACT] `cleanupStaleClaims` SQL 实现批量清 claim：SELECT → UPDATE id=ANY
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/startup-recovery.js','utf8');if(!c.includes('claimed_by = NULL'))process.exit(1);if(!c.includes('claimed_at = NULL'))process.exit(1);if(!c.includes('id = ANY'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/server.js` 启动流程调用 cleanupStaleClaims（在 syncOrphanTasksOnStartup 之后）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('cleanupStaleClaims'))process.exit(1);if(!c.includes('STALE_CLAIM_MINUTES'))process.exit(1)"

- [x] [ARTIFACT] 新增测试文件 `packages/brain/src/__tests__/cleanup-stale-claims.test.js`
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/cleanup-stale-claims.test.js')"

- [x] [BEHAVIOR] cleanupStaleClaims 在发现 2 行 stale task 时执行 UPDATE 并返回 cleaned=2；空结果返回 cleaned=0；pool 异常被捕获进 errors 数组不抛出
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/cleanup-stale-claims.test.js','utf8');if(!c.includes('cleaned).toBe(2)'))process.exit(1);if(!c.includes('cleaned).toBe(0)'))process.exit(1);if(!c.includes('connection lost'))process.exit(1)"

- [x] [BEHAVIOR] staleMinutes 默认 60，可通过 opts.staleMinutes 覆盖，SQL 第 1 个参数绑定该值
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/cleanup-stale-claims.test.js','utf8');if(!c.includes('toEqual([60])'))process.exit(1);if(!c.includes('toEqual([15])'))process.exit(1)"

## 成功标准

1. 新测试 `cleanup-stale-claims.test.js` 8 项全部通过
2. 既有 `startup-recovery-enhanced.test.js` 17 项不回归
3. `runStartupRecovery` 仍然不接受 pool、不调用 pool.query（老合约）
4. Brain 重启 log 中出现 `[Server] Startup stale-claim cleanup: cleaned=N` 一行
