# compose codex-team 挂载 rw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** codex 0.146 需可写 CODEX_HOME——compose 五个 .codex-team 挂载 `:ro`→`:rw`，守卫断言同步反转（TDD 先红后绿）。

**Architecture:** 既有 production-compose.test.js 的 `:ro` 字面断言反转即守卫；compose 五行去 ro；version bump 保证部署 recreate。

**Tech Stack:** docker compose、vitest。

## Global Constraints

- 工作目录：`/Users/administrator/worktrees/cecelia/compose-codex-home-rw`
- TDD：commit-1 = 反转断言（红）；commit-2 = compose 改动 + version bump（绿）
- 只动 4 个文件：production-compose.test.js、docker-compose.yml、packages/brain/package.json（+两份 package-lock.json）、DEFINITION.md
- `.grok` 与 `.claude-account*` 挂载保持 `:ro` 不动
- commit message 结尾：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 全部改动（红→绿两个 commit）

**Files:**
- Modify: `packages/brain/src/orchestrator/preflight/production-compose.test.js:17-21`
- Modify: `docker-compose.yml:44-51`
- Modify: `packages/brain/package.json:48` + 根与 brain 两份 package-lock.json
- Modify: `DEFINITION.md:9`

- [ ] **Step 1（commit-1 红）: 反转守卫断言**

`production-compose.test.js` 中：

```js
    for (const account of ['team1', 'team2', 'team3', 'team4', 'team5']) {
      expect(compose).toContain(
        `- /Users/administrator/.codex-${account}:/Users/administrator/.codex-${account}:ro`,
      );
    }
```

改为：

```js
    // codex 0.146 起 CODEX_HOME 必须可写（cache/sessions/locks），:ro 挂载启动即死（决策 c62c423a）
    for (const account of ['team1', 'team2', 'team3', 'team4', 'team5']) {
      expect(compose).toContain(
        `- /Users/administrator/.codex-${account}:/Users/administrator/.codex-${account}:rw`,
      );
      expect(compose).not.toContain(
        `- /Users/administrator/.codex-${account}:/Users/administrator/.codex-${account}:ro`,
      );
    }
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/orchestrator/preflight/production-compose.test.js`
Expected: FAIL（compose 仍是 :ro）。亲见红，输出记报告。

- [ ] **Step 3: Commit（红）**

```bash
git add packages/brain/src/orchestrator/preflight/production-compose.test.js
git commit -m "fix(brain): compose codex-team 挂载须可写守卫（红）"
```

- [ ] **Step 4（commit-2 绿）: compose 五行 + 注释 + 版本**

a) `docker-compose.yml`：第 45-46 行注释

```yaml
      # Provider-neutral Kernel preflight 需要看到本机已验证的全部账号状态。
      # 只读挂载：Brain 只探测；attempt launcher 再把选中的 home 挂入独立 worker。
```

改为：

```yaml
      # Provider-neutral Kernel preflight 需要看到本机已验证的全部账号状态。
      # codex home 须可写（rw）：codex 0.146 起启动即写 cache/sessions/locks，:ro 直接
      # Read-only file system 崩死 triggerCodexReview（2026-08-05 事故，决策 c62c423a）。
```

五行挂载 `:ro` 全改 `:rw`（`.codex-team1` 到 `.codex-team5`；`.grok`、`.claude-account*` 不动）。

b) `cd packages/brain && npm version patch --no-git-tag-version`（1.267.223→1.267.224），同步根目录 `npm install --package-lock-only 2>/dev/null || true`（若根 lock 未含 brain 版本则跳过），再核对根与 brain 两份 package-lock.json 里 brain 版本一致。

c) `DEFINITION.md:9`：`**Brain 版本**: 1.267.223` → `**Brain 版本**: 1.267.224`。

- [ ] **Step 5: 验证绿**

```bash
cd packages/brain && npx vitest run src/orchestrator/preflight/production-compose.test.js
cd ../.. && node scripts/facts-check.mjs
docker compose -f docker-compose.yml config >/dev/null && echo compose语法OK
```
Expected: 测试 PASS、`All facts consistent.`、compose 语法 OK。

- [ ] **Step 6: Commit（绿）**

```bash
git add docker-compose.yml packages/brain/package.json package-lock.json packages/brain/package-lock.json DEFINITION.md
git commit -m "fix(brain): compose codex-team 挂载改 rw + 版本 1.267.224（绿）"
```
