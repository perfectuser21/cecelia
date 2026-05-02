# Brain Startup Self-PID Claimed_by Dead-Lock Fix

**Goal:** 容器重启后（PID 复用），Brain 启动时无条件清除自身 claimerId 的旧 claimed_by，消除 queued 任务永久死锁。

**Architecture:** 修改 `cleanupStaleClaims`，在 60 分钟时间窗口扫描前先清除 `claimed_by = selfClaimerId` 的所有 queued 任务，不受 claimed_at 时间限制。

**Tech Stack:** Node.js, PostgreSQL（已有 startup-recovery.js + cleanup-stale-claims.test.js）

---

## 改动

**`packages/brain/src/startup-recovery.js`**
- `cleanupStaleClaims` 新增第一步：`selfClaimerId = process.env.BRAIN_RUNNER_ID || 'brain-tick-${process.pid}'`
- `UPDATE tasks SET claimed_by=NULL, claimed_at=NULL WHERE status='queued' AND claimed_by=$1`
- 记录清除数量；后续继续现有 60 分钟窗口扫描（针对其他 claimerId，排除 selfClaimerId）

**`packages/brain/src/__tests__/cleanup-stale-claims.test.js`**
- Test 1: 新鲜 claim（< 60 min）+ selfClaimerId → 应被清除
- Test 2: 旧 claim（> 60 min）+ 不同 claimerId → 应被清除（现有行为）
- Test 3: 新鲜 claim（< 60 min）+ 不同 claimerId → 不应被清除

**测试策略:** unit（mock DB pool，`vi.spyOn(process, 'pid', 'get').mockReturnValue(7)`）
