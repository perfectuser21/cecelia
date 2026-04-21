# Learning — Dashboard 飞书静默 toggle（runtime BRAIN_MUTED）

分支：cp-0421215331-muted-toggle-ui
日期：2026-04-21
Task：a07dc3a2-e222-4c94-aa89-2ffa961098ac
前置：#2509（BRAIN_MUTED env gate）

## 背景

上个 PR #2509 给 notifier.js 加了 env BRAIN_MUTED gate，但 env 只在
进程启动读一次，切换要 sudo PlistBuddy + launchctl bootout，Dashboard
没入口。本 PR 升级为 env + runtime 双层，Dashboard button 点一下即生效。

## 根本原因

上个 PR 的设计在"易操作"这一维度不完整——env gate 是最小可行产品，
但对"Alex 想开关时立刻切换"这个真实需求不够用。

## 本次解法

复用 Brain 已有的 consciousness-guard.js 双层模式：
- Layer 1: env 优先（紧急逃生口）
- Layer 2: working_memory 表 runtime toggle

notifier.js 的 gate 从硬编码读 env 改为调 isMuted()，OR 逻辑覆盖。
Dashboard LiveMonitorPage 加 toggle button 调 GET/PATCH API。
env_override=true 时 button disabled + tooltip 提示改 plist。

## 关键设计决策

**env 永远优先于 runtime**：如果 plist 写死 BRAIN_MUTED=true（紧急
止血场景），Dashboard 按钮切不动——这是有意的 fail-safe：env 代表
"系统级强制静默"，runtime toggle 是"日常操作"。两者职责不同。

## 下次预防

- [ ] 任何新 env 开关必须同步考虑"runtime 可切换 + Dashboard UI 入口"
      的三层设计（env + memory + UI），不要只做最底层
- [ ] 复用现成模板（如 consciousness-guard）节省大量工作，而不是
      从零设计每个开关——Brain 已有 5 函数模式，照抄即可

## 下一步

1. 本 PR 合并后先检查运行时：plist 里还有 BRAIN_MUTED=true（昨天
   紧急加的），**env 优先 → Dashboard toggle 仍然没用**。需要：
   - sudo PlistBuddy Delete BRAIN_MUTED
   - sudo launchctl bootout/bootstrap system/com.cecelia.brain
   - 然后 Dashboard toggle 就能真正控制飞书
2. 观察一周确认 UI toggle 可靠
3. 后续还可做：consciousness 也加同样的 Dashboard toggle（它已有
   GET/PATCH 但 Dashboard 没 UI）
