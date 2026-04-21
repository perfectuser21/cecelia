# Learning — SettingsPage 加 muted toggle（UI 入口修正）

分支：cp-0421233137-settings-muted-card
日期：2026-04-21
Task：73b048ec-9ce3-4078-b731-d8760d30ff81
前置：#2511（runtime BRAIN_MUTED + LiveMonitor UI）

## 背景

PR #2511 做了 runtime BRAIN_MUTED + API + Dashboard toggle，但 toggle
放在了 LiveMonitor 页面的 BRAIN 区块。Alex 自然去 /settings 找（那里
已有意识开关）——发现没有，反问"在哪看"。

## 根本原因

"设置"类开关的直觉位置是 /settings 页面，不是实时监控面板。上个 PR
的 plan 直接参照早期建议的"BRAIN 区块加 button"，没考虑用户心智模型。

## 本次解法

在 SettingsPage 加第二个 toggle card，和意识开关并列。两个 card 都从
/api/brain/settings/<key> 读写，结构同构。

**架构小改进**：把两个 card 共享的 UI + 状态管理提取成 ToggleCard 内部
组件（config-driven），用 CONFIGS 数组驱动。未来加第三个开关（比如
dopamine）只需往数组加一行。比复制粘贴 60 行更 maintainable。

## 保留双入口

- /settings → 全量配置中心（深度设置）
- /live-monitor BRAIN 区块 → 快捷开关（实时面板上 1 秒切）

两处都调同一 API，状态同步（因为 state 在 Brain DB）。不冲突。

### 下次预防

- [ ] "用户/调度级开关"的 UI 入口优先考虑 /settings（心智模型一致性）
- [ ] 类似共享组件（两个以上同结构 card）第一次就考虑提取 config-driven，
      不要先复制再重构（更容易漏改）
- [ ] UI 改动前先看现有页面结构（SettingsPage 已有 consciousness card 就是模板）

## 下一步

无（本 PR 合并后 /settings 就有两个并列开关，用户找得到）。
