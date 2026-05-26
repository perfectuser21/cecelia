# Registry Auto-Scan on PR Merge — 设计文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 每次 PR 合并到 main 后，自动刷新 api_registry / db_schema_registry / test_registry / system_registry(skill) 4 张表，确保 harness planner 读到最新系统状态。

**Architecture:** 新建 `scripts/run-post-merge-scan.sh` 作为 4 个已有扫描脚本的容错编排器；在 engine-ship SKILL.md §2 末尾插入调用，使其成为每次 PR 合并收尾流程的一部分。

**Tech Stack:** Bash + Node.js（已有依赖 pg）

---

## 文件结构

- 新建：`scripts/run-post-merge-scan.sh` — 容错调用 4 个 scan 脚本
- 修改：`~/.claude/skills/engine-ship/SKILL.md` — §2 末尾加一行调用

## 设计细节

### scripts/run-post-merge-scan.sh

```bash
#!/bin/bash
# PR 合并后自动刷新 4 张 registry 表
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/scan/scan-api-registry.js"  || echo "[scan] api-registry 失败，跳过"
node "$SCRIPT_DIR/scan/scan-db-schema.js"      || echo "[scan] db-schema 失败，跳过"
node "$SCRIPT_DIR/scan/scan-test-registry.js"  || echo "[scan] test-registry 失败，跳过"
node "$SCRIPT_DIR/scan/scan-skills.js"         || echo "[scan] skills 失败，跳过"
echo "[scan] registry 刷新完成"
```

- 每个扫描独立容错（`|| echo`），任一失败不阻塞其他
- 使用 `node scripts/scan/xxx.js` 避免 shebang 路径问题

### engine-ship SKILL.md 变更

在 §2 `bash scripts/write-current-state.sh` 之后追加：
```bash
bash scripts/run-post-merge-scan.sh || echo "[engine-ship] registry scan 失败，不阻塞"
```

## 测试策略

**trivial wrapper**（< 20 行，无独立 I/O 逻辑）→ 1 个 unit test：
- 验证 `scripts/run-post-merge-scan.sh` 文件存在
- 验证脚本内容包含全部 4 个 scan 调用
