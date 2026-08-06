# Red Evidence — ed911a7c-d975-4986-bfe5-24d8318838a2

**Sprint**: sprints/08060903-relay-ed911a7c  
**Red Commit**: 8b99ed646  
**Date**: 2026-08-06

## 测试文件

- `tests/capture-inbox-idempotent.test.js`（合同测试，3 个 BEHAVIOR 断言）

## Red 阶段失败原因

Red commit `8b99ed646` 时，`capture-inbox.js` 尚未添加 `ON CONFLICT (capture_id, target_type) DO NOTHING`，测试中：

- `[BEHAVIOR] capture_atoms INSERT 包含 ON CONFLICT DO NOTHING（B-1）`：断言 `atomInsertCall[0]` 匹配 `/ON CONFLICT .* DO NOTHING/` → **FAIL**（原始代码无该子句）

## 覆盖不变式

- INV-1: capture_atoms 幂等（B-1 断言 SQL 字符串）
- INV-4: 无 targetType 时不写 capture_atoms
- BEHAVIOR-3: DO NOTHING 路径 atomId=null 不抛错

## 测试冻结声明

此目录下测试文件自本 Red commit 起不得修改（immutability lock）。生产代码修复须在独立 Green commit 中完成。
