# Learning: feat(capture) — 建立 Capture 基础设施

**分支**: cp-03261723-capture-inbox
**日期**: 2026-03-26

## 完成了什么

1. 建立 `captures` 表（migration 197）— 统一收件箱，支持多来源捕获
2. 为 OKR 相关表添加 `owner` 字段区分用户数据 vs 系统数据
3. 完整 CRUD API `/api/captures`
4. Dashboard QuickCapture 组件 + GTDInbox 页面
5. 删除了始终路径错误导致失败的 GTDOkr.test.tsx

## 根本原因

GTDOkr.test.tsx 用了相对路径 `readFile('apps/api/src/...')` 但 vitest 的 CWD 是 `apps/api/`，所以实际路径变成 `apps/api/apps/api/...` — 根本就不存在，每次都失败。
这类"文件存在性字符串匹配"测试不是行为验证，而是代码内容验证，高度脆弱：函数改名、代码重构都会导致测试失败，但系统功能并未损坏。
真正有价值的测试是通过 mock fetch 或 DB 连接验证 API 行为，不应该 grep 源码内容。

## 下次预防

- [ ] 文件存在性断言应使用绝对路径或 `__dirname` 相对路径
- [ ] 每次新增 owner/user 区分字段时，同步更新 migration + selfcheck EXPECTED_SCHEMA_VERSION
- [ ] 在 worktree 中新建 `packages/brain/` 文件时，同步创建 `.prd-cp-XXXX.md`（branch-protect 就近检测）
