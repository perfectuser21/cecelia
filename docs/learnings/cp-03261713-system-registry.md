# Learning: system_registry 表 + /api/brain/registry 接口

## 根本原因

Cecelia 系统有 73 个 skill、多个 registry 文件、多台机器节点，但没有统一的"系统里有什么"的查询入口。
Claude 每次新建东西时处于"局部上下文"，看不到全局，导致重复创建。
本次对话中实际发生：重复创建了 skill-index.md，因为不知道 .agent-knowledge/skills-index.md 已存在。
根本缺口是：没有一个"创建前强制查重"的机制，也没有任何东西创建后的统一登记流程。

## 解决方案

在 Brain 加 `system_registry` 表作为全局目录，类似 OpenClaw 的 ClawHub：
- 任何东西创建前：先查 `GET /api/brain/registry/exists`
- 任何东西创建后：登记到 `POST /api/brain/registry`

## 下次预防

- [ ] 创建新 skill 时，先调 `/api/brain/registry/exists?type=skill&name=xxx`
- [ ] skill-creator 查重步骤改为调 Brain API，不只查静态文件
- [ ] 每次新增机器节点/cron/API 后，调 POST 登记

## 坑

- routes.js 用 ESM（import），但新建的 registry.js 初版用了 CommonJS（require）→ 需要统一成 ESM
- DoD 的 `Test:` 字段不能用 `tests/` 路径指向不在 packages/quality 下的文件，改用 `manual:` 格式
- facts-check 检查 DEFINITION.md 里的 schema_version 是否和 selfcheck.js 一致，两处都要同时更新
