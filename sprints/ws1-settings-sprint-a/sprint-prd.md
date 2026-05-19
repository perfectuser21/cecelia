# Sprint PRD — WS1 统一设置入口 + 侧边栏分组重构

## OKR 对齐

- **对应 KR**：Workspace Dashboard 可用性提升
- **当前进度**：基础可用
- **本次推进预期**：设置可达、导航可读

## 背景

当前侧边栏有 7 个 navGroups（Dashboard / Today / Work / Knowledge / System / 内容工厂 / 系统监控），中英文混排、分组散乱；且 `/settings` 路由虽存在（`apps/dashboard/src/pages/settings/`），但**未在任何 feature manifest 注册 navItem**，用户无法从侧边栏找到设置入口。

## Golden Path（核心场景）

用户从侧边栏 → 看到"设置"图标 → 点击进入 `/settings/brain` → 完成配置操作

具体：
1. 用户打开 Dashboard，侧边栏显示**重构后的分组**（分组数 ≤ 5，标题统一为中文或英文，不混排）
2. 用户在侧边栏找到**统一设置入口**（Settings 图标，`/settings` 路由）
3. 用户点击后进入现有 SettingsLayout（Brain 系统 / 维护 / 通知 / 账户 四 Tab），功能不变
4. 侧边栏收起时设置图标仍显示（tooltip 提示"设置"）

## Response Schema

N/A — 任务无 HTTP 响应，纯前端路由 + 导航配置改动

## 边界情况

- 侧边栏收起（`collapsed=true`）：设置 navItem 图标可见，label 隐藏，显示 tooltip
- 超级管理员专属条目：分组重构后应保留 `requireSuperAdmin` 过滤逻辑
- `/settings` 和 `/settings/brain` 均需可访问（现有 SettingsPage.tsx redirect 逻辑保留）

## 范围限定

**在范围内**：
- 在 feature manifest 中注册 `/settings` 为 navItem（统一设置入口）
- 重构 navGroups 分组（合并/重命名，数量 ≤ 5）
- 设置入口出现在侧边栏底部或系统分组内

**不在范围内**：
- SettingsLayout 内部 Tab 内容改动
- 新增 Settings Tab 或新设置功能
- 主题色、sidebar gradient 变更

## 假设

- [ASSUMPTION: 目标分组结构：Main（Dashboard/Today/Work）/ Knowledge / System / Settings，或 System 分组内追加 Settings 入口——由 Proposer 确定，PRD 仅约束"统一设置入口可从侧边栏访问"和"分组数 ≤ 5"]
- [ASSUMPTION: 设置 navItem 对所有已登录用户可见（不限 superAdmin）]
- [ASSUMPTION: 入口图标使用 `Settings`（Lucide） ]

## 预期受影响文件

- `frontend/src/features/core/system-hub/index.ts`（或新建 settings feature manifest）：注册 `/settings` navItem
- `frontend/src/features/core/*/index.ts`：navGroups order/label 调整，实现分组重构
- `apps/dashboard/src/pages/settings/SettingsLayout.tsx`：可能需要路由注册适配（若 DynamicRouter 接管 `/settings/*`）
- `apps/dashboard/src/pages/settings/SettingsPage.tsx`：确保 redirect 保持兼容

## journey_type: user_facing
## journey_type_reason: 任务核心是侧边栏导航 UI 变化（用户可见的 Dashboard 交互）
## target_environment: mac_web
## target_environment_reason: Dashboard 前端 E2E 在本机 Playwright 执行，localhost:5174
