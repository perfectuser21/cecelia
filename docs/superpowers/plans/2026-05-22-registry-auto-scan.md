# Registry Auto-Scan on PR Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每次 PR 合并后自动刷新 api_registry / db_schema_registry / test_registry / system_registry 4 张表。

**Architecture:** 新建 `scripts/run-post-merge-scan.sh` 容错编排 4 个已有 scan 脚本；在 engine-ship SKILL.md §2 末尾插入调用；用 1 个 vitest unit test 验证脚本存在且内容正确。

**Tech Stack:** Bash, Node.js, vitest

---

## File Structure

- Create: `scripts/run-post-merge-scan.sh`
- Create: `packages/brain/src/__tests__/run-post-merge-scan.test.js`
- Modify: `~/.claude/skills/engine-ship/SKILL.md` (line 51, §2 末尾)

---

### Task 1: 写失败测试

**Files:**
- Create: `packages/brain/src/__tests__/run-post-merge-scan.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// packages/brain/src/__tests__/run-post-merge-scan.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SCRIPT = resolve(process.cwd(), 'scripts/run-post-merge-scan.sh');

describe('run-post-merge-scan.sh', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('包含 4 个 scan 调用', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('scan-api-registry.js');
    expect(content).toContain('scan-db-schema.js');
    expect(content).toContain('scan-test-registry.js');
    expect(content).toContain('scan-skills.js');
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
cd packages/brain && npx vitest run src/__tests__/run-post-merge-scan.test.js --reporter=verbose
```

期望：2 个测试 FAIL（脚本不存在）

- [ ] **Step 3: 提交红测试**

```bash
git add packages/brain/src/__tests__/run-post-merge-scan.test.js
git commit -m "test(brain): run-post-merge-scan 脚本存在性验证（红）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 实现脚本 + 接入 engine-ship

**Files:**
- Create: `scripts/run-post-merge-scan.sh`
- Modify: `~/.claude/skills/engine-ship/SKILL.md`

- [ ] **Step 1: 创建 run-post-merge-scan.sh**

```bash
#!/bin/bash
# PR 合并后自动刷新 4 张 registry 表
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/scan/scan-api-registry.js"   || echo "[scan] api-registry 失败，跳过"
node "$SCRIPT_DIR/scan/scan-db-schema.js"       || echo "[scan] db-schema 失败，跳过"
node "$SCRIPT_DIR/scan/scan-test-registry.js"   || echo "[scan] test-registry 失败，跳过"
node "$SCRIPT_DIR/scan/scan-skills.js"          || echo "[scan] skills 失败，跳过"
echo "[scan] registry 刷新完成"
```

```bash
chmod +x scripts/run-post-merge-scan.sh
```

- [ ] **Step 2: 确认测试通过**

```bash
cd packages/brain && npx vitest run src/__tests__/run-post-merge-scan.test.js --reporter=verbose
```

期望：2 个测试 PASS

- [ ] **Step 3: 修改 engine-ship SKILL.md**

在 `~/.claude/skills/engine-ship/SKILL.md` 状态更新脚本行（已退役）之后、闭合的 ` ``` ` 之前，插入：

```
bash scripts/run-post-merge-scan.sh || echo "[engine-ship] registry scan 失败，不阻塞"
```

修改后该段变为：
```bash
# 状态更新脚本（已退役）
bash scripts/run-post-merge-scan.sh || echo "[engine-ship] registry scan 失败，不阻塞"
```

- [ ] **Step 4: 提交实现**

```bash
git add scripts/run-post-merge-scan.sh
git commit -m "feat(brain): PR 合并后自动刷新 4 张 registry 表

- 新增 scripts/run-post-merge-scan.sh，容错调用 4 个 scan 脚本
- 接入 engine-ship §2，每次 PR 合并后自动触发

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
