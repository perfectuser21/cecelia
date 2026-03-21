---
name: codex-test-gen
version: 1.0.0
created: 2026-03-21
description: |
  Codex 自动测试生成。扫描覆盖率低的模块，自动生成单元测试。
  运行在西安 Mac mini M4（Codex），不需要 Claude Code。
  由 Brain 自动派发，推动免疫系统 KR。
---

# codex-test-gen — Codex 自动测试生成

**执行位置**: 西安 Mac mini M4（Codex）
**task_type**: `codex_test_gen`
**角色归属**: CTO（coding domain）

## 触发方式

Brain 自动派发（定时或免疫系统检测到覆盖率低时）：

```json
{
  "task_type": "codex_test_gen",
  "title": "自动生成测试: packages/brain/src/xxx.js",
  "payload": {
    "target_file": "packages/brain/src/xxx.js",
    "target_package": "brain",
    "reason": "覆盖率 < 50%"
  }
}
```

## 执行流程

### Step 1: 确定目标

如果 payload 指定了 `target_file`，直接使用。否则自动扫描：

```bash
# 扫描覆盖率低的文件（如果有 coverage 数据）
# 优先选择：
# 1. 有逻辑但无测试的文件
# 2. 覆盖率 < 50% 的文件
# 3. 最近修改但无测试的文件
```

### Step 2: 分析源码

1. 读取目标文件
2. 理解导出的函数/类
3. 识别边界条件和错误路径
4. 检查是否已有测试文件

### Step 3: 生成测试

在对应的 `__tests__/` 目录创建测试文件：

```
packages/brain/src/xxx.js
→ packages/brain/src/__tests__/xxx.test.js
```

测试规范：
- 使用 vitest（`import { describe, it, expect, vi } from 'vitest'`）
- Mock 外部依赖（数据库、API、文件系统）
- 覆盖：正常路径 + 错误路径 + 边界条件
- 每个导出函数至少 2 个测试用例

### Step 4: 验证

```bash
# 运行生成的测试确保通过
npx vitest run <test-file> --reporter=verbose
```

### Step 5: 提交

```bash
git add <test-file>
git commit -m "test: 自动生成测试 — <target_file>"
git push
# 创建 PR
```

## 输出

- 1 个测试文件（PR 提交）
- 测试运行结果（通过/失败）

## 不做什么

- 不改源码（只写测试）
- 不重写已有测试（只补充缺失的）
- 不做端到端测试（只做单元测试）
