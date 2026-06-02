# B56 loadSkillContent fail-fast 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 executing-plans。Steps 用 `- [ ]` 追踪。

**Goal:** `loadSkillContent` 找不到 SKILL.md 时 fail-fast 抛错（不再返回空串静默降级），且失败不缓存。

**Architecture:** 改 `packages/brain/src/harness-shared.js` 单个函数 `loadSkillContent`：移除"找不到返回空串 + 缓存空串"，改为 throw（带诊断路径）+ 只缓存成功结果。调用方（generator/planner/proposer/reviewer/evaluator）无需改——throw 冒泡成 LangGraph 节点 error → task.status=failed（loud failure）。

**Tech Stack:** Node.js ESM, vitest（mock fs）

---

### Task 1: loadSkillContent fail-fast + 不缓存失败

**Files:**
- Modify: `packages/brain/src/harness-shared.js`（loadSkillContent，约 line 45-59）
- Create: `packages/brain/src/__tests__/load-skill-content.test.js`

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/__tests__/load-skill-content.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { loadSkillContent } from '../harness-shared.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('B56 loadSkillContent fail-fast', () => {
  it('找不到 SKILL.md（所有路径 miss）→ throw（不返回空串）', () => {
    existsSync.mockReturnValue(false);
    expect(() => loadSkillContent('b56-nonexistent-skill-a')).toThrow(/SKILL\.md not found/);
  });

  it('throw message 含搜索路径（诊断价值）', () => {
    existsSync.mockReturnValue(false);
    expect(() => loadSkillContent('b56-nonexistent-skill-b')).toThrow(/skills/);
  });

  it('失败不缓存：首次 miss throw 后，路径恢复 → 第二次返回内容', () => {
    // 首次全 miss → throw
    existsSync.mockReturnValue(false);
    expect(() => loadSkillContent('b56-recover-skill')).toThrow();
    // 路径恢复
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('RECOVERED SKILL CONTENT');
    expect(loadSkillContent('b56-recover-skill')).toBe('RECOVERED SKILL CONTENT');
  });

  it('成功结果仍缓存：第二次调用不再读文件', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('CACHED SKILL');
    expect(loadSkillContent('b56-cache-skill')).toBe('CACHED SKILL');
    const callsAfterFirst = readFileSync.mock.calls.length;
    expect(loadSkillContent('b56-cache-skill')).toBe('CACHED SKILL');
    // cache hit → readFileSync 调用次数不增加
    expect(readFileSync.mock.calls.length).toBe(callsAfterFirst);
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/b56-loadskill-failfast
ln -sfn /Users/administrator/perfect21/cecelia/node_modules node_modules 2>/dev/null || true
cd packages/brain && node /Users/administrator/worktrees/cecelia/b56-loadskill-failfast/node_modules/.bin/vitest run src/__tests__/load-skill-content.test.js
```
Expected: FAIL —「找不到 → throw」用例失败（当前返回空串不抛），「失败不缓存」失败（当前缓存空串）

- [ ] **Step 3: 改 loadSkillContent**

`packages/brain/src/harness-shared.js`，把现有 `loadSkillContent`（约 line 45-59）整体替换为：

```js
export function loadSkillContent(skillName) {
  if (_skillCache.has(skillName)) return _skillCache.get(skillName);
  const tried = [];
  for (const base of SKILL_SEARCH_DIRS) {
    const p = path.join(base, skillName, 'SKILL.md');
    tried.push(p);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf8');
        _skillCache.set(skillName, content); // 只缓存成功结果
        return content;
      } catch { /* 读失败继续下一路径，不缓存 */ }
    }
  }
  // B56: 找不到 SKILL.md = 系统配置错误，fail-fast（不返回空串、不缓存失败）。
  // 历史 bug：返回空串 + 缓存空串 → generator 拿空 SKILL prompt 静默跑出无 PR 的假成功。
  throw new Error(
    `loadSkillContent: SKILL.md not found for "${skillName}". Searched: ${tried.join(', ')}`
  );
}
```

同时更新函数上方 JSDoc 注释（约 line 40-44）的「找不到返回空串（不抛错，让 prompt 能回退）」描述为：

```js
/**
 * 读取 skill 的 SKILL.md 内容（成功结果缓存）。
 * 按 SKILL_SEARCH_DIRS 顺序查找。
 * B56: 找不到/读失败 → throw（不返回空串、不缓存失败）。
 * 调用方拿空 SKILL 静默降级会跑出错误成果（generator 无 PR），故 fail-fast。
 */
```

- [ ] **Step 4: 跑测试确认 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/b56-loadskill-failfast/packages/brain && node /Users/administrator/worktrees/cecelia/b56-loadskill-failfast/node_modules/.bin/vitest run src/__tests__/load-skill-content.test.js
```
Expected: 4 passed

- [ ] **Step 5: 跑相关测试确认无回归（5 个调用方 + harness workflows）**

```bash
cd /Users/administrator/worktrees/cecelia/b56-loadskill-failfast/packages/brain && node /Users/administrator/worktrees/cecelia/b56-loadskill-failfast/node_modules/.bin/vitest run src/workflows/__tests__/ src/__tests__/load-skill-content.test.js 2>&1 | tail -15
```
Expected: 全 PASS（若有测试依赖 loadSkillContent 返回空串，需修该测试改为期望 throw — 但应无，因无节点应在缺 SKILL 时正常工作）

- [ ] **Step 6: Commit（commit-1 fail test + commit-2 impl 两段式）**

```bash
cd /Users/administrator/worktrees/cecelia/b56-loadskill-failfast
git add packages/brain/src/__tests__/load-skill-content.test.js
git commit -m "test(brain): B56 failing test — loadSkillContent 找不到 SKILL 应 fail-fast"
git add packages/brain/src/harness-shared.js
git commit -m "fix(brain): B56 — loadSkillContent 找不到 SKILL fail-fast + 不缓存失败（消灭空 SKILL 静默降级）"
```

---

### 验收标准
- [ ] loadSkillContent 找不到 → throw（不返回空串）
- [ ] 失败不缓存，下次可重试；成功仍缓存
- [ ] 4 个单元测试 PASS
- [ ] workflows 测试无回归
- [ ] CI 全绿
