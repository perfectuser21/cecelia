# Task Card: Harness E2E 零干预 — 3 个断链修复

## 目标
修复阻止 Harness pipeline 零人工干预跑完的 3 个根本原因。

## Bug 清单

### Bug 1: SESSION_TTL 4h → dispatch 停止
- 文件: `packages/brain/src/slot-allocator.js:29`
- `SESSION_TTL_SECONDS = 4h`，运行 9.5h 的 session 被标 stale → absent 模式 → budget=0
- 修复: 改为 24h（`24 * 60 * 60`）

### Bug 2: harness_report 静默失败（goal_id=null）
- 文件: `packages/brain/src/actions.js:15`
- `isSystemTask('harness_report', 'harness_watcher')` 返回 false
- deploy_watch task 的 goal_id=null → createTask 抛错 → 被 catch 静默吞掉
- 修复: 将 `'harness_watcher'` 加入 `systemSources`

### Bug 3: harness_generate pr_url 缺失 → 整个 callback 静默失败
- 文件: `packages/brain/src/routes/execution.js`
- 6 层 fallback 后 pr_url 仍 null → throw Error → 被上层 catch 吞掉 → 无 ci_watch
- 修复: throw 改为创建 `harness_fix` 重试任务（pipeline 自愈而非卡死）

## DoD

- [x] **[ARTIFACT]** `slot-allocator.js` SESSION_TTL 改为 24h
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');if(!c.includes('24 * 60 * 60'))process.exit(1);console.log('OK')"`

- [x] **[ARTIFACT]** `actions.js` isSystemTask systemSources 包含 'harness_watcher'
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/actions.js','utf8');if(!c.includes(\"'harness_watcher'\"))process.exit(1);console.log('OK')"`

- [x] **[BEHAVIOR]** harness_generate pr_url 缺失时创建 harness_fix 而非静默失败
  - Test: `tests/brain-unit`

## 成功标准

新 harness 任务从 planner 跑到 harness_report，全程零人工干预。
