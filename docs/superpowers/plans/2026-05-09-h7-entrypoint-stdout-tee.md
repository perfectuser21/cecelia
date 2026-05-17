# H7 entrypoint.sh tee STDOUT_FILE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: 修 `docker/cecelia-runner/entrypoint.sh` 的 `run_claude()` — 把 claude stdout `tee` 写到 `STDOUT_FILE`，并用 `${PIPESTATUS[0]}` 保留真实 exit code。让 brain 真能从 callback body 拿到 claude 容器的 stdout（generator/proposer 实际产出）。

**Architecture**: Layer 3 spawn-and-interrupt 跑完 claude 后，entrypoint.sh 读 `/tmp/cecelia-prompts/${CECELIA_TASK_ID}.stdout` 拼 callback body。但 `run_claude()` 没把 stdout 写到这文件 → callback body 永远 `{"stdout":""}`。最小改动：claude 调用末尾加 `2>&1 | tee "$STDOUT_FILE"` + `return ${PIPESTATUS[0]}`。

**Tech Stack**: bash / vitest / node child_process

**Spec**: `docs/superpowers/specs/2026-05-09-h7-entrypoint-stdout-tee-design.md`

**Brain task**: 4965a3ef-108b-4f36-8b42-114f531ede99

**Note on E2E**: spec 明确不做 docker integration E2E（CI 无 docker runtime，HK self-hosted runner 已停）。本 plan 用 vitest unit test 覆盖 [BEHAVIOR]，提取 `run_claude` 函数体在临时目录跑 mock claude 二进制验证 tee + PIPESTATUS。

---

## File Structure

- **Create**: `cp-0509133354-h7-entrypoint-stdout-tee.prd.md` — PRD（DoD 三要素必含）
- **Create**: `cp-0509133354-h7-entrypoint-stdout-tee.dod.md` — DoD 验收清单（[BEHAVIOR] 必备）
- **Create**: `tests/docker/entrypoint-stdout-tee.test.js` — vitest unit test（提取 run_claude 函数 + mock claude）
- **Modify**: `docker/cecelia-runner/entrypoint.sh` 第 100-115 行 — 把 STDOUT_FILE 提到 run_claude 之前 + run_claude 加 tee + PIPESTATUS
- **Create**: `docs/learnings/cp-0509133354-h7-entrypoint-stdout-tee.md` — Learning 文件（push 前必备）

---

### Task 1: Write PRD + DoD docs（worktree 根目录）

**Files**:
- Create: `cp-0509133354-h7-entrypoint-stdout-tee.prd.md`
- Create: `cp-0509133354-h7-entrypoint-stdout-tee.dod.md`

**Why**: branch-protect.sh 在 push 前校验 worktree 根目录的 .prd.md + .dod.md。CLAUDE.md DoD 三要素（[BEHAVIOR] / 勾选 [x] / feat 含测试）在合并前 CI L1 校验。

- [ ] **Step 1.1：写 PRD**

写 `cp-0509133354-h7-entrypoint-stdout-tee.prd.md`：

```markdown
# PRD: H7 entrypoint.sh tee stdout 到 STDOUT_FILE

**Brain task**: 4965a3ef-108b-4f36-8b42-114f531ede99
**Spec**: docs/superpowers/specs/2026-05-09-h7-entrypoint-stdout-tee-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1

## 背景

Layer 3 spawn-and-interrupt（PR #2845, 2026-04-28）把 harness 容器从 `exec claude` 改成"先跑 claude → 拿 exit_code → POST callback → 退出"。

但 `docker/cecelia-runner/entrypoint.sh:107-113` `run_claude()` 直接让 claude stdout 打到 terminal：detached docker spawn 后无人 attach，stdout 全部丢失。第 132 行读 `STDOUT_FILE` 永远空 → callback body 永远 `{"stdout":""}`。

后果：brain 看不到 generator/proposer 容器实际产出（PR URL/commit hash），W8 acceptance 5 次跑全部漏过 contract verification。

## 修法

`run_claude()` 给 claude 调用加 `tee "$STDOUT_FILE"`：

​```bash
STDOUT_FILE="/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.stdout"

run_claude() {
  if [[ -f "$PROMPT_FILE" ]]; then
    claude -p ... < "$PROMPT_FILE" 2>&1 | tee "$STDOUT_FILE"
    return ${PIPESTATUS[0]}
  else
    claude -p ... "$@" 2>&1 | tee "$STDOUT_FILE"
    return ${PIPESTATUS[0]}
  fi
}
​```

## 成功标准

- callback body `stdout` 字段不再恒为 ""
- claude 真实 exit code 被保留（不被 tee 0 覆盖）
- 非 harness 任务的 exec 路径完全不变

## 不做

- 不动 callback body 拼装逻辑（132-145 行）
- 不动非 harness 任务 exec 路径（117-123 行）
- 不引入 stdout 流式上传（4000 字节 tail 现状已够）
- 不做 H8/H9/proposer verify push（独立 PR）
```

- [ ] **Step 1.2：写 DoD**

写 `cp-0509133354-h7-entrypoint-stdout-tee.dod.md`：

```markdown
# DoD: H7 entrypoint.sh tee stdout 到 STDOUT_FILE

## 验收清单

- [ ] [BEHAVIOR] entrypoint.sh harness 路径下 claude stdout 写入 STDOUT_FILE，可 tail 读
  Test: tests/docker/entrypoint-stdout-tee.test.js

- [ ] [BEHAVIOR] run_claude 退出码 = claude 真实退出码（不被 tee 吃掉）
  Test: tests/docker/entrypoint-stdout-tee.test.js

- [ ] [ARTIFACT] entrypoint.sh run_claude 函数含 `tee "$STDOUT_FILE"` 和 `${PIPESTATUS[0]}`
  Test: manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8');if(!/tee \"\\$STDOUT_FILE\"/.test(c))process.exit(1);if(!c.includes('PIPESTATUS[0]'))process.exit(1)"

- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/docker/entrypoint-stdout-tee.test.js')"

## Learning

文件: docs/learnings/cp-0509133354-h7-entrypoint-stdout-tee.md

## 测试命令

​```bash
npx vitest run tests/docker/entrypoint-stdout-tee.test.js
​```
```

- [ ] **Step 1.3：commit PRD + DoD**

```bash
git add cp-0509133354-h7-entrypoint-stdout-tee.prd.md cp-0509133354-h7-entrypoint-stdout-tee.dod.md
git commit -m "docs: H7 entrypoint stdout tee PRD + DoD"
```

---

### Task 2: Write failing vitest unit test (BEHAVIOR coverage)

**Files**:
- Create: `tests/docker/entrypoint-stdout-tee.test.js`

**TDD iron law**：commit-1 测试必须 FAIL（因为 entrypoint.sh 还没改）。

- [ ] **Step 2.1：创 tests/docker/ 目录并写测试**

`tests/docker/entrypoint-stdout-tee.test.js` 完整代码：

```javascript
// SPDX-License-Identifier: MIT
// Test for docker/cecelia-runner/entrypoint.sh run_claude tee behavior.
// 目的：保证 Layer 3 spawn-and-interrupt 后 callback body 能拿到 claude stdout，
// 而不是 PR #2845 引入的"永远空字符串"BUG。

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENTRYPOINT_PATH = path.join(REPO_ROOT, 'docker/cecelia-runner/entrypoint.sh');

function extractRunClaudeFn() {
  const src = readFileSync(ENTRYPOINT_PATH, 'utf8');
  const m = src.match(/^run_claude\(\) \{[\s\S]+?^\}/m);
  if (!m) throw new Error('run_claude() not found in entrypoint.sh');
  return m[0];
}

function runWithMockClaude({ stdoutLines, exitCode, withPromptFile }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'h7-tee-'));

  // mock claude 二进制：把 stdoutLines 打到 stdout 然后 exit
  const mockClaude = path.join(dir, 'claude');
  const echoCmds = stdoutLines.map((l) => `echo ${JSON.stringify(l)}`).join('\n');
  writeFileSync(
    mockClaude,
    `#!/usr/bin/env bash\n${echoCmds}\nexit ${exitCode}\n`,
    'utf8',
  );
  chmodSync(mockClaude, 0o755);

  const promptFile = path.join(dir, 'prompt.txt');
  if (withPromptFile) writeFileSync(promptFile, 'test prompt');

  const stdoutFile = path.join(dir, 'task.stdout');

  const fnBody = extractRunClaudeFn();
  const wrapper = `
set -o pipefail
${fnBody}
MODEL_FLAGS=()
PROMPT_FILE="${promptFile}"
STDOUT_FILE="${stdoutFile}"
run_claude
echo "EXIT_CODE=$?"
`;

  const result = spawnSync('bash', ['-c', wrapper], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
  });

  return { dir, stdoutFile, result };
}

describe('entrypoint.sh run_claude tee STDOUT_FILE', () => {
  const dirsToCleanup = [];
  afterEach(() => {
    while (dirsToCleanup.length) {
      try { rmSync(dirsToCleanup.pop(), { recursive: true, force: true }); } catch {}
    }
  });

  test('writes claude stdout to STDOUT_FILE when PROMPT_FILE exists', () => {
    const { dir, stdoutFile, result } = runWithMockClaude({
      stdoutLines: ['MOCK_LINE_A', 'MOCK_LINE_B'],
      exitCode: 0,
      withPromptFile: true,
    });
    dirsToCleanup.push(dir);
    expect(result.status).toBe(0);
    const content = readFileSync(stdoutFile, 'utf8');
    expect(content).toContain('MOCK_LINE_A');
    expect(content).toContain('MOCK_LINE_B');
    expect(result.stdout).toMatch(/EXIT_CODE=0/);
  });

  test('writes claude stdout to STDOUT_FILE when PROMPT_FILE absent (else branch)', () => {
    const { dir, stdoutFile, result } = runWithMockClaude({
      stdoutLines: ['NO_PROMPT_BRANCH_X'],
      exitCode: 0,
      withPromptFile: false,
    });
    dirsToCleanup.push(dir);
    expect(result.status).toBe(0);
    expect(readFileSync(stdoutFile, 'utf8')).toContain('NO_PROMPT_BRANCH_X');
  });

  test('preserves claude exit code via PIPESTATUS[0] (not swallowed by tee)', () => {
    const { dir, result } = runWithMockClaude({
      stdoutLines: ['out'],
      exitCode: 7,
      withPromptFile: true,
    });
    dirsToCleanup.push(dir);
    expect(result.stdout).toMatch(/EXIT_CODE=7/);
  });
});
```

- [ ] **Step 2.2：跑测试，期待 FAIL（entrypoint.sh 还没改）**

```bash
cd /Users/administrator/worktrees/cecelia/h7-entrypoint-stdout-tee
npx vitest run tests/docker/entrypoint-stdout-tee.test.js
```

期望输出：3 个 test 全部 FAIL（提取到的 run_claude 函数体不含 tee → STDOUT_FILE 不存在或为空）。

- [ ] **Step 2.3：commit fail test (commit 1 of 2)**

```bash
git add tests/docker/entrypoint-stdout-tee.test.js
git commit -m "test(docker): add failing test for run_claude STDOUT_FILE tee"
```

---

### Task 3: Implement entrypoint.sh fix (impl commit 2 of 2)

**Files**:
- Modify: `docker/cecelia-runner/entrypoint.sh` 第 100-115 行（把 STDOUT_FILE 提到 run_claude 上方 + run_claude 加 tee + PIPESTATUS[0]）

- [ ] **Step 3.1：改 entrypoint.sh**

把第 106 行：
```bash
PROMPT_FILE="/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.prompt"
```
改为：
```bash
PROMPT_FILE="/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.prompt"
STDOUT_FILE="/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.stdout"
```

把第 108-114 行 `run_claude()` 改为：
```bash
run_claude() {
  if [[ -f "$PROMPT_FILE" ]]; then
    claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" < "$PROMPT_FILE" 2>&1 | tee "$STDOUT_FILE"
    return ${PIPESTATUS[0]}
  else
    claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" "$@" 2>&1 | tee "$STDOUT_FILE"
    return ${PIPESTATUS[0]}
  fi
}
```

把原第 132 行 `STDOUT_FILE="..."` 删掉（已上提）。注意原 `if [[ -f "$STDOUT_FILE" ]]; then ... fi` 块仍保留（变量已在上面定义）。

- [ ] **Step 3.2：本地静态校验通过**

```bash
bash -n docker/cecelia-runner/entrypoint.sh && echo "syntax OK"
```

期望：`syntax OK`

- [ ] **Step 3.3：跑 vitest，期待 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/h7-entrypoint-stdout-tee
npx vitest run tests/docker/entrypoint-stdout-tee.test.js
```

期望：3 个 test 全 PASS。

- [ ] **Step 3.4：跑 ARTIFACT manual: 检查命令**

```bash
node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8');if(!/tee \"\\\$STDOUT_FILE\"/.test(c))process.exit(1);if(!c.includes('PIPESTATUS[0]'))process.exit(1);console.log('ARTIFACT_OK')"
```

期望：输出 `ARTIFACT_OK`，exit 0。

- [ ] **Step 3.5：commit impl (commit 2 of 2)**

```bash
git add docker/cecelia-runner/entrypoint.sh
git commit -m "fix(brain): entrypoint.sh tee stdout to STDOUT_FILE — Layer 3 callback stdout no longer empty (#H7)"
```

---

### Task 4: Update DoD checkboxes & write Learning

**Files**:
- Modify: `cp-0509133354-h7-entrypoint-stdout-tee.dod.md`（4 项 `[ ]` → `[x]`）
- Create: `docs/learnings/cp-0509133354-h7-entrypoint-stdout-tee.md`

CLAUDE.md 强制：push 前所有 DoD 必须 `[x]`，且 Learning 文件必须含 `### 根本原因` + `### 下次预防` + `- [ ]` checklist。

- [ ] **Step 4.1：DoD 4 项全部勾上 `[x]`**

```bash
sed -i '' 's/- \[ \]/- [x]/g' cp-0509133354-h7-entrypoint-stdout-tee.dod.md
grep -c '\- \[x\]' cp-0509133354-h7-entrypoint-stdout-tee.dod.md
```

期望：`4`

- [ ] **Step 4.2：写 Learning 文件**

`docs/learnings/cp-0509133354-h7-entrypoint-stdout-tee.md` 内容：

```markdown
# Learning: H7 — entrypoint.sh tee stdout 到 STDOUT_FILE

**PR**: cp-0509133354-h7-entrypoint-stdout-tee
**Sprint**: langgraph-contract-enforcement / Stage 1

## 现象

W8 harness acceptance 5 次连跑（v6 → v10）全部 fail，brain 看不到 sub_task 容器的 claude stdout，callback body 永远 `{"stdout":""}` → 漏过 contract verification（PR URL / commit hash 全丢）。

## 根本原因

PR #2845 重构 Layer 3 spawn-and-interrupt 时，把 entrypoint.sh 从 `exec claude`（前台）改成"先跑 claude → 拿 exit_code → POST callback → 退出"。但 `run_claude()` 让 claude stdout 直接打到 terminal（detached docker spawn 后无人 attach），第 132 行 `STDOUT_FILE` 仍按旧设计期望从该文件读 stdout，**没人写它**。

哲学层根因：detached docker container 模式下，所有副作用（stdout/stderr/文件写入）必须显式持久化，不能依赖 attach。这是 LangGraph node-level contract verification 的子集 —— 节点执行结束必须把"产出"主动写到 brain 可读的位置，否则 brain 拿到空数据等同节点 silent fail。

## 下次预防

- [ ] 任何 detached docker spawn 模式下的脚本，`echo` / `printf` / 子进程 stdout 必须显式 `tee` 或重定向到 brain 已知的文件路径
- [ ] PR review 时凡涉及 docker spawn 模式切换（attach ↔ detach），必须 grep 所有 `claude` / `npm` / `node` 等长跑命令是否有 stdout 持久化
- [ ] Layer 3 后续节点设计：每个 LLM 节点结束必须 brain-side verify 副作用真发生（spec 阶段 2 的 contract enforcement layer）
```

- [ ] **Step 4.3：commit DoD checked + Learning**

```bash
git add cp-0509133354-h7-entrypoint-stdout-tee.dod.md docs/learnings/cp-0509133354-h7-entrypoint-stdout-tee.md
git commit -m "docs: H7 DoD checked + Learning"
```

---

### Task 5: Push + create PR + foreground wait CI

**Files**: 无

按 CLAUDE.md `feedback_foreground_block_ci_wait.md`：手动 /dev 必须 foreground until 阻塞当前 turn 等 CI 完成。

- [ ] **Step 5.1：push branch**

```bash
cd /Users/administrator/worktrees/cecelia/h7-entrypoint-stdout-tee
git push -u origin cp-0509133354-h7-entrypoint-stdout-tee
```

- [ ] **Step 5.2：开 PR**

```bash
gh pr create --title "fix(brain): entrypoint.sh tee stdout to STDOUT_FILE — H7 (Stage 1/4)" --body "$(cat <<'EOF'
## Summary

修 H7：`docker/cecelia-runner/entrypoint.sh` `run_claude()` 加 `tee "$STDOUT_FILE"` + `${PIPESTATUS[0]}`，让 brain 真能拿到 claude 容器的 stdout。

PR #2845 把 Layer 3 改成 spawn-and-interrupt 模式后，detached docker spawn 没人 attach claude stdout → callback body 永远 `{"stdout":""}` → W8 acceptance 5 次跑全部漏过 contract verification。

Sprint: langgraph-contract-enforcement / Stage 1（4 个 PR 的第 1 个）
Brain task: 4965a3ef-108b-4f36-8b42-114f531ede99
Spec: docs/superpowers/specs/2026-05-09-h7-entrypoint-stdout-tee-design.md

## Test plan

- [x] tests/docker/entrypoint-stdout-tee.test.js (3 unit tests, vitest)
- [x] ARTIFACT 静态检查通过（manual:node -e）
- [x] bash -n syntax 校验通过
- [ ] 合并后 brain redeploy + W8 v11 一个 sub_task 容器，`docker exec` 验证 STDOUT_FILE 被写入

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5.3：foreground 阻塞等 CI 全部 PASS**

```bash
PR_NUMBER=$(gh pr view --json number -q '.number')
echo "Waiting for CI to complete on PR #${PR_NUMBER}..."
until [[ $(gh pr checks "${PR_NUMBER}" 2>/dev/null | grep -cE '\bpending|\bin_progress') -eq 0 ]]; do
  sleep 30
done
gh pr checks "${PR_NUMBER}"
```

期望：所有 check 显示 `pass` / `success`，无 `fail`。

如果 CI fail：systematic-debugging 第 N 次失败 → 派 dispatching-parallel-agents（按 Tier 1 BLOCKED 第 3 次规则）。

---

## Self-Review

**Spec coverage**：
- spec §2 修法 → Task 3 ✓
- spec §3 不动什么 → Task 3.1 明确只动 106/108-114/132 行 ✓
- spec §4 测试策略 trivial wrapper + 两层验证 → Task 2 (BEHAVIOR unit test) + Task 3.4 (ARTIFACT 静态检查) ✓
- spec §5 DoD 4 项 → Task 1.2 (DoD 文件) + Task 4.1 (勾选) ✓
- spec §6 合并后真实证 → PR description "Test plan" 第 4 项（合并后人工验证），不在本 plan 范围 ✓

**Placeholder scan**：
- 无 TBD / TODO / 模糊 "implement later" ✓
- 所有 step 都给具体命令、代码、期望输出 ✓

**Type consistency**：
- `STDOUT_FILE` 命名在 PRD/DoD/spec/test/impl 一致 ✓
- `run_claude` 函数名一致 ✓
- `PIPESTATUS[0]` 写法一致 ✓
- 测试文件路径 `tests/docker/entrypoint-stdout-tee.test.js` 在 DoD/spec/plan/PR description 全部一致 ✓

**TDD iron law**：
- Task 2 commit 1 = fail test
- Task 3 commit 2 = impl + 同 PR 内
- controller 应在合并前 `git log --oneline` 验证顺序 ✓
