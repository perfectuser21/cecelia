# W19 Playground Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 cecelia monorepo 顶层建独立 `playground/` 子项目（Express + vitest），仅含 GET /health endpoint，作为后续 W19 harness pipeline 的"被加工对象"。

**Architecture:** ESM Node 子项目，与 cecelia core 解耦（不进 monorepo workspace、不被 brain CI 扫描），测试用 supertest 直 request app 实例（NODE_ENV=test 不真 listen），一个 vitest 单测验 /health。

**Tech Stack:** Node.js (ESM), Express 4.21, vitest 4.1, supertest 7.0

**上游 PRD:** `docs/handoffs/2026-05-10-w19-walking-skeleton-playground-handoff-prd.md` §3
**Design:** `docs/superpowers/specs/2026-05-10-w19-playground-bootstrap-design.md`
**Branch:** `cp-0510164812-w19-playground-bootstrap`
**Worktree:** `/Users/administrator/worktrees/cecelia/w19-playground-bootstrap`

---

## File Map

| 文件 | 职责 | 大小 |
|---|---|---|
| `playground/package.json` | 子项目元数据 + 依赖 + scripts | ~15 行 |
| `playground/server.js` | Express app，GET /health → {ok:true}，NODE_ENV=test 不 listen | ~13 行 |
| `playground/tests/server.test.js` | vitest + supertest 单测 /health | ~12 行 |
| `playground/README.md` | 用途 + 启动方式 + W19 上下文 | ~30 行 |
| `docs/learnings/cp-0510164812-w19-playground-bootstrap.md` | per-branch Learning（必含根本原因 + 下次预防 + checklist） | ~30 行 |

---

## Task 1: 写失败测试 + 安装依赖（TDD red）

**Files:**
- Create: `playground/package.json`
- Create: `playground/tests/server.test.js`

- [ ] **Step 1: 写 package.json**

文件 `playground/package.json` 完整内容：

```json
{
  "name": "cecelia-playground",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.21.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^4.1.5"
  }
}
```

注：`"private": true` 阻止误发布到 npm。

- [ ] **Step 2: 安装依赖**

Run（在 worktree 内）:
```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap/playground && npm install
```

Expected: `npm install` 成功，无 vulnerability error。生成 `node_modules/` 与 `package-lock.json`。

- [ ] **Step 3: 写失败测试**

文件 `playground/tests/server.test.js` 完整内容：

```js
import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('playground server', () => {
  test('GET /health → 200 {ok: true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap/playground && npm test 2>&1 | tail -20
```

Expected: vitest 抛 `Cannot find module '../server.js'` 或 `Failed to resolve import "../server.js"`，1 test failed。

- [ ] **Step 5: Commit (TDD red)**

```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap
git add playground/package.json playground/package-lock.json playground/tests/server.test.js
git commit -m "test(playground): failing /health test (TDD red)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

注：node_modules 在 .gitignore 默认会被忽略；如不在则需新增 `playground/node_modules/` 到 .gitignore。Step 6 中确认。

- [ ] **Step 6: 确认 .gitignore 含 node_modules**

```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap && git check-ignore playground/node_modules || echo "MISSING — need to add"
```

Expected: 输出 `playground/node_modules`（已被 ignore）。如果 MISSING，把 `playground/node_modules/` 添加到根 `.gitignore`，作为 amend（git add .gitignore && git commit --amend --no-edit）。

---

## Task 2: 实现 server.js + README.md（TDD green）

**Files:**
- Create: `playground/server.js`
- Create: `playground/README.md`

- [ ] **Step 1: 写 server.js**

文件 `playground/server.js` 完整内容：

```js
import express from 'express';

const app = express();
const PORT = process.env.PLAYGROUND_PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`playground listening on ${PORT}`));
}

export default app;
```

- [ ] **Step 2: 写 README.md**

文件 `playground/README.md` 完整内容：

````markdown
# cecelia-playground

W19 Walking Skeleton 测试床。本子项目刻意保持极薄，给 Cecelia harness pipeline 提供一个"外部代码改动对象"——后续 W19+ task 由 generator container push PR 给这里加 endpoint，evaluator container 自起 server 真验证。

## 跟 cecelia core 的关系

完全独立子项目。Brain / Engine / Workspace **不依赖** playground。playground 也不感知 brain。这是刻意的解耦：harness 测协议层时不能让"亲爹打亲爹"环路（详见 `docs/handoffs/2026-05-10-w19-walking-skeleton-playground-handoff-prd.md` §10）。

## 启动

```bash
cd playground
npm install
npm test            # 单测
npm start           # 起 server（默认 :3000）
```

## 端点

- `GET /health` → `{ "ok": true }`

W19 task 会增加 `GET /sum?a=N&b=M`（不在 bootstrap 范围）。
````

- [ ] **Step 3: 跑测试确认通过**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap/playground && npm test 2>&1 | tail -20
```

Expected: `1 passed`，无 fail。

- [ ] **Step 4: 验证 NODE_ENV=test import 不抛错**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap/playground && NODE_ENV=test node -e "import('./server.js').then(()=>console.log('OK'))"
```

Expected: 输出 `OK`，进程 0 退出。

- [ ] **Step 5: Commit (TDD green)**

```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap
git add playground/server.js playground/README.md
git commit -m "feat(playground): minimal Express + /health (TDD green)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 写 Learning 文件

**Files:**
- Create: `docs/learnings/cp-0510164812-w19-playground-bootstrap.md`

- [ ] **Step 1: 写 Learning 文件**

文件 `docs/learnings/cp-0510164812-w19-playground-bootstrap.md` 完整内容：

```markdown
# Learning — W19 Playground Bootstrap

**日期**: 2026-05-10
**分支**: cp-0510164812-w19-playground-bootstrap
**类型**: feat（新增独立子项目）

## 背景

W6-W18 18 次 harness pipeline 跑全 fail，根因是 W8 acceptance test 选错（让 generator 改 brain 自己代码、evaluator 验 brain 自己 runtime）。修了 10 PR 协议层（H7-H16）后需要一个干净的 walking skeleton bootstrap 跑通完整 pipeline，证明"代码工厂"能从 PRD 一键到 working code + 真验证。

## 根本原因

W8 类 acceptance test 在当前架构（host 上 cecelia-node-brain 不会自动重启加载新代码）下结构性不可能跑通：
- 自指环路（generator 改 brain → main 涨 → 永远改不到老版本）
- contract 数字漂移（pin brain.version 那一刻就过期）
- evaluator 验老 brain（curl localhost:5221 是 host 上未重启的老 brain）

## 下次预防

- [x] 不让 generator 改 packages/brain/src/（避开 W8 反模式）
- [x] 不在 contract 写 `curl localhost:5221`（那是 brain，跟 playground 无关）
- [x] 不 pin cecelia 内部 version 数字
- [x] 让 evaluator 在自己 sandbox 内启 playground server（自起自验，跟 host 老进程无关）
- [x] playground 完全独立子项目（顶层目录、不进 monorepo workspace、brain CI 不扫描）
- [x] 测试策略四档（unit/integration/E2E/trivial）写进 design spec

## Walking Skeleton 原则

bootstrap 只 GET /health，不加 /sum——/sum 是 W19 task 的产出物，bootstrap 加了就破坏 walking skeleton 测试目的（要让 generator container 真改代码、evaluator container 真验改后效果）。
```

- [ ] **Step 2: Commit Learning**

```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap
git add docs/learnings/cp-0510164812-w19-playground-bootstrap.md
git commit -m "docs(learnings): W19 playground bootstrap

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 勾选 design DoD checkbox

**Files:**
- Modify: `docs/superpowers/specs/2026-05-10-w19-playground-bootstrap-design.md`

- [ ] **Step 1: 验证 4 条 DoD 全部已通过**

| DoD | 验证命令 | Expected |
|---|---|---|
| ARTIFACT package.json 含依赖 | `node -e "const p=require('./playground/package.json');if(!p.dependencies.express\|\|!p.devDependencies.vitest)process.exit(1);console.log('OK')"` | OK |
| ARTIFACT server.js 含 /health | `grep -q '/health' playground/server.js && echo OK` | OK |
| BEHAVIOR vitest 1/1 PASS | `cd playground && npm test 2>&1 \| grep -E "1 passed"` | 1 passed |
| BEHAVIOR NODE_ENV=test 不抛错 | `cd playground && NODE_ENV=test node -e "import('./server.js').then(()=>process.exit(0)).catch(()=>process.exit(1))"` | exit 0 |

依次跑这 4 条命令，全 PASS 才能进入 Step 2。

- [ ] **Step 2: 在 design doc §9 把 4 个 `[ ]` 改成 `[x]`**

用 Edit tool 修改 `docs/superpowers/specs/2026-05-10-w19-playground-bootstrap-design.md`：
- 把 `## 9. DoD（4 条）` 下的 4 个 `- [ ]` 改成 `- [x]`
- 把 `## 10. 成功标准` 下的 6 个 `- [ ]` 改成 `- [x]`（前 3 个本地可验，后 3 个推 PR 后才能验，但 push 前规则要求全 [x]，本地能 simulate 的标 [x]，runtime 后验证项保留 [ ] 在 PR description 描述）

实际操作：本地能验的 4 项 DoD + 本地能验的 3 项成功标准（4文件就位/npm install 干净/npm test 1/1）改 [x]；剩余 3 项（PR push CI 全绿/PR merged/main 含 /health）保留 [ ]，改成"待 push 后验"备注。

更安全的做法：CI 检查的是 DoD 区块（带 [BEHAVIOR]/[ARTIFACT]），把那 4 条 DoD 改成 [x] 即可；成功标准区块只是给人看的 checklist，CI 不强校验。

- [ ] **Step 3: Commit DoD tick**

```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap
git add docs/superpowers/specs/2026-05-10-w19-playground-bootstrap-design.md
git commit -m "chore(playground): tick DoD checkboxes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 本地端到端冒烟（push 前完成品验证）

参考 memory `feedback_complete_product_delivery.md` 五项要求中的"端到端实体验证"。push 前在本机真起 server + curl 一次。

- [ ] **Step 1: 真起 server**

```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap/playground
PLAYGROUND_PORT=3009 node server.js &
SERVER_PID=$!
sleep 1
```

- [ ] **Step 2: curl 真验证**

```bash
curl -s localhost:3009/health
```

Expected: `{"ok":true}`。

- [ ] **Step 3: kill server**

```bash
kill $SERVER_PID
```

- [ ] **Step 4: 记录冒烟结果（口头）**

无需 commit，把冒烟结果写到 PR body Test plan section（Task 6 用）。

---

## Task 6: Push + 创 PR + 等 CI + merge

- [ ] **Step 1: Pre-push 自检**

```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap
git log --oneline main..HEAD
```

Expected: 4 commits（spec + test red + impl green + learning + DoD tick），按时间顺序。

- [ ] **Step 2: Push**

```bash
git push -u origin cp-0510164812-w19-playground-bootstrap 2>&1 | tail -10
```

Expected: 成功，输出 `[new branch]` 与 PR 创建提示链接。

- [ ] **Step 3: 创 PR**

```bash
gh pr create --base main --title "feat(playground): W19 walking skeleton bootstrap" --body "$(cat <<'EOF'
## Summary

为 W19 Walking Skeleton harness pipeline 提供独立的"被加工对象"——`cecelia/playground/` 子项目（Express + vitest），仅含 `GET /health → {ok:true}`。

bootstrap 只搭骨架，**不加 /sum**——/sum 是 W19 task 的产出物（PRD §10 严禁本 PR 加，否则破坏 walking skeleton 测试目的）。

详见 `docs/superpowers/specs/2026-05-10-w19-playground-bootstrap-design.md` 与 `docs/handoffs/2026-05-10-w19-walking-skeleton-playground-handoff-prd.md` §3。

## Test plan

- [x] 本地 `npm install` 干净
- [x] 本地 `npm test` 1/1 PASS
- [x] 本地 `NODE_ENV=test node -e "import('./server.js')"` 不抛错
- [x] 本地真起 server `PLAYGROUND_PORT=3009 node server.js` + `curl localhost:3009/health` 返 `{"ok":true}` ✓
- [ ] CI 全绿（push 后等待）
- [ ] PR merged
- [ ] `git show origin/main:playground/server.js` 含 `/health`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: 输出 PR URL。

- [ ] **Step 4: 前台 until 阻塞等 CI 全绿**

按 memory `feedback_foreground_block_ci_wait.md` 与 `feedback_harness_mode_shortcut.md`：手动 /dev 必须前台 until loop 阻塞，不能 run_in_background。

```bash
cd /Users/administrator/worktrees/cecelia/w19-playground-bootstrap
PR_URL=$(gh pr view --json url -q .url)
echo "Watching $PR_URL"
until [[ $(gh pr checks 2>/dev/null | grep -cE "pending|queued|in_progress") == "0" ]]; do
  echo "[$(date +%H:%M:%S)] CI still pending..."
  sleep 30
done
gh pr checks 2>&1 | tail -20
```

Expected: 全 pass / success（可能有少数 skipped 也算 OK）。任一 fail → 进入 fix loop。

- [ ] **Step 5: Auto-merge（squash，无 admin 绕过）**

```bash
gh pr merge --squash --delete-branch
```

Expected: 输出 merged 信息。

注：禁止 `--admin`（违反 memory CI 等待规则）。如有 fail check 必须先修。

---

## Task 7: 合并后清理 + 验证完成品 5 项

- [ ] **Step 1: 拉 main**

```bash
cd /Users/administrator/perfect21/cecelia
git checkout main && git pull --rebase origin main
```

- [ ] **Step 2: main 有 /health endpoint**

```bash
git show origin/main:playground/server.js | grep -E "app\.get.*'/health'"
```

Expected: 输出 `app.get('/health', (req, res) => {`。

- [ ] **Step 3: main 上跑测试 1/1 PASS**

```bash
cd /Users/administrator/perfect21/cecelia/playground && npm install && npm test 2>&1 | tail -5
```

Expected: `1 passed`。

- [ ] **Step 4: 完成品 5 项自检表**

| # | 项 | 状态 |
|---|---|---|
| 1 | 代码写完 + commit | Task 1-4 4 个 commits |
| 2 | PR push + CI 全绿 | Task 6 Step 4 验过 |
| 3 | PR merged 到 main | Task 6 Step 5 |
| 4 | 真实部署完成 | playground 是子项目无独立部署，npm install + npm start 即"部署" |
| 5 | 端到端实体验证 | Task 5 真起 server + curl + 200 + body 校验 |

5 项全到位 = bootstrap 阶段完成。

- [ ] **Step 5: Brain task 状态回写（如 Brain task 已注册）**

bootstrap PR 不一定通过 Brain task 注册（这是手动准备步骤）。如果有 task_id：

```bash
curl -s -X PATCH localhost:5221/api/brain/tasks/<task_id> \
  -H "Content-Type: application/json" \
  -d '{"status":"completed","result":{"pr_url":"<PR_URL>","merged":true}}'
```

无 task_id 则 skip。

---

## Self-Review

**1. Spec coverage**：
- spec §3 (4 文件) → Task 1-2 全覆盖 ✓
- spec §6 (测试策略) → Task 1 写测试 + Task 5 端到端 ✓
- spec §9 DoD 4 条 → Task 4 全勾 ✓
- spec §10 成功标准 → Task 5/6/7 端到端 ✓
- spec §11 不做（4 条）→ 不在本 plan 内的"禁忌行为"，每项 plan 都没踩 ✓

**2. Placeholder scan**：grep 全文无 TBD/TODO/implement later/fill in details/Add appropriate ✓

**3. Type consistency**：
- "playground/server.js" 全文一致 ✓
- "GET /health" / `app.get('/health'` 一致 ✓
- "NODE_ENV=test" 一致 ✓
- "PLAYGROUND_PORT=3000" 默认 / 测试用 3009 区分清楚 ✓

无需修。

---

## Execution

Per /dev autonomous Tier 1 默认走 **Subagent-Driven**。下一棒 superpowers:subagent-driven-development。
