---
branch: cp-03120808-codex-provider-routing
date: 2026-03-12
pr: TBD
---

# Learning: codex-bridge /run + executor provider 路由

## 根本原因

codex_qa 任务在本机失败（"Not logged in"），因为：
1. LOCATION_MAP 中 `codex_qa: 'us'`，任务留在本机运行
2. executor.js 没有路由到西安 codex-bridge 的逻辑
3. 本机没有 Codex 账号登录

## 解决方案

三层修改：
1. task-router.js: `codex_qa → 'xian'`（新增 xian 节点）
2. executor.js: `triggerCodexBridge()` 函数 + location=xian 路由
3. codex-bridge.cjs: `POST /run` 通用端点（/execute 的 Brain 专用别名）

## provider 自由选择设计

任务现在支持三种路由方式：
- `location=xian` 或 `task.provider='codex'` → 西安 codex-bridge（Codex CLI）
- `location=hk` → 香港 MiniMax
- `location=us`（默认） → 本地 cecelia-bridge（Claude/MiniMax）

## 下次预防

- [ ] 新增执行节点时，需同步更新：task-router LOCATION_MAP + isValidLocation + executor 路由分支 + migration（location CHECK）
- [ ] codex-bridge 重启后验证 /health 端点确认启动成功
- [ ] facts-check.mjs 会检查 brain_version 和 schema_version，更新时两者都要同步到 DEFINITION.md
