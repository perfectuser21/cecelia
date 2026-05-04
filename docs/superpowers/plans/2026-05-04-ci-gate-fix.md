# CI Gate 彻底修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **TDD IRON LAW (NO EXCEPTIONS):**
> - NO PRODUCTION CODE WITHOUT FAILING TEST FIRST
> - Throwaway prototype 才 skip — 你不是写 prototype
> - 每 task 必须 git commit 顺序：commit-1 fail test / commit-2 impl
> - controller 会 verify commit 顺序，不符合让你重做

**Goal:** 修复 CI 中 harness-contract-lint 静默失效 bug，并优化 dod-behavior-dynamic / harness-dod-integrity 无条件触发问题。

**Architecture:** 仅修改 `.github/workflows/ci.yml` 一个文件。P1 在 `ci-passed` 的 `check()` 调用列表中追加一行；P2 在 `changes` job 输出中新增 `dod` 检测，并给两个 dod 相关 job 加条件触发。

**Tech Stack:** GitHub Actions YAML；测试用 Node.js 文件读取断言（无需安装额外依赖）。

---

## 文件结构

| 操作 | 文件 | 说明 |
|------|------|------|
| Modify | `.github/workflows/ci.yml` | 唯一修改文件（5 处定点修改）|
| Create | `DoD.md` | PR 验收条目（[ARTIFACT] + [BEHAVIOR]）|

---

### Task 1：写 failing 测试 + DoD

**Files:**
- Create: `DoD.md`（验收条目）
- No additional test files — 测试内嵌在 DoD BEHAVIOR 中，用 `node -e` 直接断言 ci.yml 内容

- [ ] **Step 1：确认当前 ci.yml 不含目标字符串（红灯验证）**

在 worktree 根目录 `/Users/administrator/worktrees/cecelia/ci-gate-fix` 中运行：

```bash
# P1 check — 应该 exit 1（字符串不存在 = fail）
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!c.includes('check \"harness-contract-lint\"')) process.exit(1); console.log('FOUND')" && echo "UNEXPECTED PASS" || echo "EXPECTED FAIL ✅"

# P2 check — dod output 不存在（应该 exit 1）
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('changes:'); const seg=c.slice(idx, idx+800); if(!seg.includes('dod=')) process.exit(1); console.log('FOUND')" && echo "UNEXPECTED PASS" || echo "EXPECTED FAIL ✅"

# P2 check — dod-behavior-dynamic 无 needs changes（应该 exit 1）
node -e "
const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');
const idx=c.indexOf('dod-behavior-dynamic:');
const seg=c.slice(idx, idx+400);
if(seg.includes('needs: [changes]')) { console.log('FOUND'); } else { process.exit(1); }
" && echo "UNEXPECTED PASS" || echo "EXPECTED FAIL ✅"
```

预期输出：3 行都是 `EXPECTED FAIL ✅`（红灯确认）。

- [ ] **Step 2：写 DoD.md**

在 `/Users/administrator/worktrees/cecelia/ci-gate-fix/DoD.md` 创建文件，内容如下（注意全部改为 `[x]` 在实现完成后，现在先写 `[ ]`）：

```markdown
# DoD — CI Gate 彻底修复

task_id: c7af8b9e-0233-4f9d-8875-9753e1478b70

## 验收条目

- [ ] [ARTIFACT] `.github/workflows/ci.yml` 已修改（5 处定点改动）
  Test: manual:node -e "require('fs').accessSync('.github/workflows/ci.yml')"

- [ ] [BEHAVIOR] ci-passed 的 check() 调用包含 harness-contract-lint
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!c.includes('check \"harness-contract-lint\"')) process.exit(1)"

- [ ] [BEHAVIOR] changes job 输出 dod 字段（DoD 文件变更检测）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('      - id: detect'); const seg=c.slice(idx,idx+1500); if(!seg.includes('dod=')) process.exit(1)"

- [ ] [BEHAVIOR] dod-behavior-dynamic 含 needs: [changes] 条件
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('dod-behavior-dynamic:'); const seg=c.slice(idx,idx+400); if(!seg.includes('needs: [changes]')) process.exit(1)"

- [ ] [BEHAVIOR] harness-dod-integrity 含 needs: [changes] 条件
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('harness-dod-integrity:'); const seg=c.slice(idx,idx+400); if(!seg.includes('needs: [changes]')) process.exit(1)"
```

**注意**：commit DoD 时保持 `[ ]`（红灯状态）。Task 2 Step 7 验证全通过后再改为 `[x]`，然后 commit。

- [ ] **Step 3：commit DoD（红灯 commit）**

```bash
cd /Users/administrator/worktrees/cecelia/ci-gate-fix
git add DoD.md
git commit -m "test(ci): DoD — CI gate fix 红灯（harness-contract-lint + dod 条件触发）"
```

预期：commit 成功，这是 "failing test commit"（DoD 条目尚未满足）。

---

### Task 2：实现 5 处定点修改，让所有 BEHAVIOR 变绿

**Files:**
- Modify: `.github/workflows/ci.yml`

工作目录：`/Users/administrator/worktrees/cecelia/ci-gate-fix`

#### 修改 1：`changes` job 新增 `dod` output 声明

找到 `changes` job 的 `outputs:` 块（约第 22-26 行），在 `compose` 行之后加一行：

```yaml
      compose: ${{ steps.detect.outputs.compose }}
      dod: ${{ steps.detect.outputs.dod }}
```

- [ ] **Step 1：编辑 ci.yml — changes outputs 加 dod**

在文件中找到：
```
      compose: ${{ steps.detect.outputs.compose }}
```
在其正下方插入：
```
      dod: ${{ steps.detect.outputs.dod }}
```

#### 修改 2：`changes` job 的 detect run 新增 dod 检测

找到 `detect` step 的 `run:` 块（含 brain/engine/workspace/compose 四行检测），在 `compose=` 行之后加一行：

```bash
echo "dod=$(echo "$CHANGED" | grep -qE '^(DoD\.md|task-card\.md|\.task-|\.dod-)' && echo true || echo false)" >> $GITHUB_OUTPUT
```

- [ ] **Step 2：编辑 ci.yml — detect run 加 dod 检测**

找到：
```
          echo "compose=$(echo "$CHANGED" | grep -qE '^(docker-compose\.yml|packages/brain/Dockerfile|scripts/brain-(docker-up|docker-down|build)\.sh)$' && echo true || echo false)" >> $GITHUB_OUTPUT
```
在其正下方插入：
```
          echo "dod=$(echo "$CHANGED" | grep -qE '^(DoD\.md|task-card\.md|\.task-|\.dod-)' && echo true || echo false)" >> $GITHUB_OUTPUT
```

#### 修改 3：`dod-behavior-dynamic` 加 needs + if

找到 `dod-behavior-dynamic:` job 定义，它目前没有 `needs:` 和 `if:` 行，直接从 `runs-on:` 开始。

- [ ] **Step 3：编辑 ci.yml — dod-behavior-dynamic 加 needs + if**

找到：
```
  dod-behavior-dynamic:
    runs-on: ubuntu-latest
    timeout-minutes: 12
```
替换为：
```
  dod-behavior-dynamic:
    needs: [changes]
    if: needs.changes.outputs.dod == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 12
```

#### 修改 4：`harness-dod-integrity` 加 needs + if

找到 `harness-dod-integrity:` job 定义，同样没有 `needs:` 和 `if:` 行。

- [ ] **Step 4：编辑 ci.yml — harness-dod-integrity 加 needs + if**

找到：
```
  harness-dod-integrity:
    runs-on: ubuntu-latest
    timeout-minutes: 5
```
替换为：
```
  harness-dod-integrity:
    needs: [changes]
    if: needs.changes.outputs.dod == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
```

#### 修改 5：`ci-passed` check() 加 harness-contract-lint

找到 `ci-passed` job 的 `check` 调用列表，`check "harness-dod-integrity"` 那一行，在其正下方插入：

- [ ] **Step 5：编辑 ci.yml — ci-passed 加 harness-contract-lint check**

找到：
```
          check "harness-dod-integrity"  "${{ needs.harness-dod-integrity.result }}"
          check "docker-infra-smoke"     "${{ needs.docker-infra-smoke.result }}"
```
替换为：
```
          check "harness-dod-integrity"  "${{ needs.harness-dod-integrity.result }}"
          check "harness-contract-lint"  "${{ needs.harness-contract-lint.result }}"
          check "docker-infra-smoke"     "${{ needs.docker-infra-smoke.result }}"
```

#### 验证所有 BEHAVIOR

- [ ] **Step 6：运行所有 BEHAVIOR 验证命令**

```bash
cd /Users/administrator/worktrees/cecelia/ci-gate-fix

# BEHAVIOR 1: harness-contract-lint 已加入 check()
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!c.includes('check \"harness-contract-lint\"')) process.exit(1); console.log('✅ P1 OK')"

# BEHAVIOR 2: changes job 含 dod= 检测
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('      - id: detect'); const seg=c.slice(idx,idx+1500); if(!seg.includes('dod=')) process.exit(1); console.log('✅ P2-dod-output OK')"

# BEHAVIOR 3: dod-behavior-dynamic 含 needs: [changes]
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('dod-behavior-dynamic:'); const seg=c.slice(idx,idx+400); if(!seg.includes('needs: [changes]')) process.exit(1); console.log('✅ P2-dod-behavior-dynamic OK')"

# BEHAVIOR 4: harness-dod-integrity 含 needs: [changes]
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('harness-dod-integrity:'); const seg=c.slice(idx,idx+400); if(!seg.includes('needs: [changes]')) process.exit(1); console.log('✅ P2-harness-dod-integrity OK')"

# ARTIFACT: ci.yml 存在
node -e "require('fs').accessSync('.github/workflows/ci.yml'); console.log('✅ ARTIFACT OK')"
```

预期：5 行全部 `✅ ... OK`。

- [ ] **Step 7：将 DoD.md 所有 `[ ]` 改为 `[x]`**

确认所有验证通过后，将 `DoD.md` 中所有 `- [ ]` 改为 `- [x]`。

- [ ] **Step 8：commit 实现（绿灯 commit）**

```bash
cd /Users/administrator/worktrees/cecelia/ci-gate-fix
git add .github/workflows/ci.yml DoD.md
git commit -m "fix(ci): P1 harness-contract-lint 静默失效 + P2 dod-behavior-dynamic 条件触发优化

- ci-passed check() 追加 harness-contract-lint（失败现可阻断合并）
- changes job 新增 dod output（检测 DoD.md / task-card.md 等文件变更）
- dod-behavior-dynamic: needs [changes] + if dod==true（无 DoD 文件时跳过 postgres 启动）
- harness-dod-integrity: needs [changes] + if dod==true（保持一致）

task-id: c7af8b9e-0233-4f9d-8875-9753e1478b70"
```

预期：commit 成功，此为 "绿灯 commit"（所有 BEHAVIOR 已验证）。

---

## commit 顺序检验

完成后运行 `git log --oneline -5`，预期看到：

```
<hash> fix(ci): P1 harness-contract-lint 静默失效 + P2 dod-behavior-dynamic 条件触发优化
<hash> test(ci): DoD — CI gate fix 红灯（harness-contract-lint + dod 条件触发）
<hash> docs: CI gate fix design spec (2026-05-04)
...
```

红灯 commit 必须在绿灯 commit 之前。
