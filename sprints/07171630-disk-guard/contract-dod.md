# Contract DoD: disk-guard

**TASK_ID**: ba6fe51c-0948-48da-8889-beb1aa14ede8
**Sprint**: 07171630-disk-guard
**版本**: v1.0
**日期**: 2026-07-17

---

## [BEHAVIOR] 断言列表

### [BEHAVIOR] [BEHAVIOR-1] T-01：高水位（≥85%）触发完整清理序列，序列严格按 INV-04 顺序

**场景**：mock `df /System/Volumes/Data` 返回 87%  
**断言**：
1. `docker container prune` 在 `docker builder prune` 之前调用
2. `docker builder prune` 在 `runWorktreeReaper()` 之前调用
3. `runWorktreeReaper()` 在 npm/homebrew 缓存清理之前调用
4. 日志输出含 `[disk_check] used=87% action=clean`
5. 四个清理步骤全部被调用（无遗漏）

**对应测试文件**：`sprints/07171630-disk-guard/tests/disk-guard.test.js`  
**it() 描述**：`[BEHAVIOR-1] df 87% 触发完整清理序列，序列按 INV-04 顺序`

---

### [BEHAVIOR] [BEHAVIOR-2] T-02：低水位（<80%）不触发清理，打 action=none 日志

**场景**：mock `df /System/Volumes/Data` 返回 75%  
**断言**：
1. docker container prune / docker builder prune / npm cache clean 均未被调用
2. worktree-reaper 未被触发
3. 日志输出含 `[disk_check] used=75% action=none`

**对应测试文件**：`sprints/07171630-disk-guard/tests/disk-guard.test.js`  
**it() 描述**：`[BEHAVIOR-2] df 75% 不触发清理，打 action=none 日志`

---

### [BEHAVIOR] [BEHAVIOR-3] T-03：中水位（80%~84%）触发飞书告警，不触发清理

**场景**：mock `df /System/Volumes/Data` 返回 82%  
**断言**：
1. 飞书告警函数被调用（且仅调用一次）
2. docker container prune / builder prune 均未被调用
3. 日志输出含 `[disk_check] used=82% action=warn`

**对应测试文件**：`sprints/07171630-disk-guard/tests/disk-guard.test.js`  
**it() 描述**：`[BEHAVIOR-3] df 82% 仅发飞书告警，不触发清理序列`

---

### [BEHAVIOR] [BEHAVIOR-4] T-04：清后复测仍≥90% 发 Bark 推送

**场景**：mock df 首次返回 91%，清理后复测仍返回 90%  
**断言**：
1. Bark 推送函数被调用
2. 日志输出含 `[disk_check]` 且含 `action=bark`
3. 飞书告警也被调用（≥80% 条件满足）

**对应测试文件**：`sprints/07171630-disk-guard/tests/disk-guard.test.js`  
**it() 描述**：`[BEHAVIOR-4] 清后复测仍 ≥90% 发 Bark 推送`

---

### [BEHAVIOR] [BEHAVIOR-5] T-05（worktree）：终态任务超 24h worktree 被删除

**场景**：worktree 目录 `task-abc12345`，DB 查询返回 status=completed，updated_at 为 25h 前  
**断言**：
1. 对应目录被 `rm -rf`（fs.rm 被调用，路径匹配）
2. 日志含 `[worktree_reap] task=abc12345 status=completed action=deleted`

**对应测试文件**：`sprints/07171630-disk-guard/tests/worktree-reaper.test.js`  
**it() 描述**：`[BEHAVIOR-5] 终态任务 updated_at 超 25h，目录被删除`

---

### [BEHAVIOR] [BEHAVIOR-6] T-06（INV-01 回归）：in_progress 任务 worktree 绝对不删除

**场景**：worktree 目录 `task-xyz99999`，DB 查询返回 status=in_progress  
**断言**：
1. `fs.rm` / `rm -rf` **完全未被调用**（任何路径）
2. 日志含 `[worktree_reap] task=xyz99999 status=in_progress action=skipped`

**对应测试文件**：`sprints/07171630-disk-guard/tests/worktree-reaper.test.js`  
**it() 描述**：`[BEHAVIOR-6][回归] in_progress worktree 绝对不删（INV-01 防第 6 次误杀）`

---

### [BEHAVIOR] [BEHAVIOR-7] T-07：worktree 目录名无法匹配任何 task → 跳过不删

**场景**：worktree 目录 `task-unknown0`，DB 查询返回 404 / 空结果  
**断言**：
1. `fs.rm` 未被调用
2. 日志含 `[worktree_reap] task=unknown0 status=unknown action=skipped`

**对应测试文件**：`sprints/07171630-disk-guard/tests/worktree-reaper.test.js`  
**it() 描述**：`[BEHAVIOR-7] task 查不到记录，跳过不删（fail-open）`

---

### [BEHAVIOR] [BEHAVIOR-8] T-08：scheduler-jobs 含 disk-guard 条目，参数符合规格

**场景**：直接 import JOBS 数组  
**断言**：
1. 存在 `name === 'disk-guard'` 的条目
2. `timeoutMs === 120_000`
3. `needsPool === false`
4. `handler` 为函数

**对应测试文件**：`sprints/07171630-disk-guard/tests/disk-guard.test.js`  
**it() 描述**：`[BEHAVIOR-8] scheduler-jobs JOBS 含 disk-guard，参数规格正确`

---

### [BEHAVIOR] [BEHAVIOR-9] INV-03：每轮执行必出 [disk_check] 日志（含出错时）

**场景**：mock df 命令抛出 Error  
**断言**：
1. 函数不抛出（catch 住）
2. 日志含 `[disk_check] error=...`（非静默失败）

**对应测试文件**：`sprints/07171630-disk-guard/tests/disk-guard.test.js`  
**it() 描述**：`[BEHAVIOR-9] df 命令失败时 catch 并打 error 日志，不静默吞掉`

---

### [BEHAVIOR] [BEHAVIOR-10] INV-05（节流）：15min 内重复调用不执行

**场景**：连续两次调用 `runDiskGuard()`，间隔 < 15min  
**断言**：
1. 第二次调用时 df 命令未被执行
2. `lastRunAt` 未被更新（可通过 spy 验证 execAsync 调用次数 === 1）

**对应测试文件**：`sprints/07171630-disk-guard/tests/disk-guard.test.js`  
**it() 描述**：`[BEHAVIOR-10] 15min 内重复调用节流 gate，df 只执行一次`

---

## manual:bash 可执行验收命令

```bash
# 1. 验证生产容器内有 [disk_check] 日志
docker logs $(docker ps -q --filter name=brain) 2>&1 | grep '\[disk_check\]' | tail -5

# 2. 手动触发一轮 disk-guard（需 Brain 运行中）
curl -X POST localhost:5221/api/brain/cron/trigger \
  -H "Content-Type: application/json" \
  -d '{"job":"disk-guard"}'

# 3. 触发后再次检查日志
sleep 5 && docker logs $(docker ps -q --filter name=brain) 2>&1 | grep '\[disk_check\]' | tail -5

# 4. 验证 [worktree_reap] 日志
docker logs $(docker ps -q --filter name=brain) 2>&1 | grep '\[worktree_reap\]' | tail -10

# 5. 验证 in_progress worktree 保护（回归）
# 在 worktrees 目录创建一个 in_progress 的假目录，触发 reaper，确认目录还在
TEST_DIR="/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-testip01"
mkdir -p "$TEST_DIR"
# （确保 DB 中 task id 前缀 testip01 对应 in_progress 任务，或无记录 → fail-open）
curl -X POST localhost:5221/api/brain/cron/trigger \
  -H "Content-Type: application/json" \
  -d '{"job":"worktree-reaper"}'
sleep 3
ls "$TEST_DIR" && echo "PASS: in_progress worktree 未被删除" || echo "FAIL: 目录被删除"

# 6. 运行单测
cd /workspace && npx vitest run sprints/07171630-disk-guard/tests/ --reporter=verbose 2>&1 | tail -30
```

---

## 铁律检查清单

| 铁律 | 覆盖的 [BEHAVIOR] |
|------|-------------------|
| INV-01 fail-open | BEHAVIOR-6, BEHAVIOR-7 |
| INV-02 先写 failing test | 所有（TDD Red 阶段） |
| INV-03 日志必出 | BEHAVIOR-9（error 场景）+ BEHAVIOR-1/2/3/4 |
| INV-04 清理序列固定 | BEHAVIOR-1 |
