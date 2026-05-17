# Prompt 改动指令（L2 动态契约）

**目标**：
1. Implementer 强制交付 TDD artifact（`.tdd-evidence/<task>-red.log` + `.tdd-evidence/<task>-green.log`）
2. Spec Reviewer 新增核心检查第 6 项（验证 TDD artifact 真实性，含反向填充检测）

**影响文件**（位于 `packages/engine/skills/dev/prompts/subagent-driven-development/`）：
- implementer-prompt.md（113 行 → 预计 +约 60 行）
- spec-reviewer-prompt.md（61 行 → 预计 +约 42 行）
- code-quality-reviewer-prompt.md（26 行 → 不改）

**注意**：三个文件都是用 triple-backtick 包起来的 prompt 模板，插入内容必须**在外层代码块内**，保持 prompt 语义连贯。

---

## File 1: implementer-prompt.md

### 改动 1: 在 "Your Job" 段落紧随其后新增 "TDD 交付物要求（L2 动态契约强制）" 小节

**定位锚点（old_string 的匹配位置）**：
找到这行（原文第 38-41 行附近，"Your Job" 段落末尾）：

```
    Work from: [directory]

    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    It's always OK to pause and clarify. Don't guess or make assumptions.

    ## Code Organization
```

**修改方式**：在 `It's always OK to pause and clarify. Don't guess or make assumptions.` 与 `## Code Organization` 之间插入新的 `## TDD Deliverables Contract (L2 Dynamic Enforcement)` 段落。

**Edit old_string**（保持缩进 4 个空格 + 2 空行风格）:
````
    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    It's always OK to pause and clarify. Don't guess or make assumptions.

    ## Code Organization
````

**Edit new_string**:
````
    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    It's always OK to pause and clarify. Don't guess or make assumptions.

    ## TDD Deliverables Contract (L2 Dynamic Enforcement)

    When the task specifies test-driven development (or when it involves any behavior
    change with testable outcomes), you MUST produce TDD evidence artifacts. These are
    verified by the Spec Reviewer (check #6) and by CI (`check-pipeline-evidence`).
    Missing or implausible artifacts will cause your work to be REJECTED.

    ### Phase 1: Red (test fails first)
    1. Write the test file at `tests/<module>.test.ts` (or project-appropriate path).
    2. Run tests WITHOUT the implementation and capture full output:
       ```
       mkdir -p .tdd-evidence
       npm test -- tests/<module>.test.ts > .tdd-evidence/<module>-red.log 2>&1
       echo "exit=$?" >> .tdd-evidence/<module>-red.log
       ```
    3. Verify the exit code is non-zero AND the failure is a genuine assertion failure
       (NOT a syntax error, missing import, or typo — those do not count as red).

    ### Phase 2: Green (implement, test passes)
    1. Write the minimum implementation to make the test pass.
    2. Run the SAME test file and capture output:
       ```
       npm test -- tests/<module>.test.ts > .tdd-evidence/<module>-green.log 2>&1
       echo "exit=$?" >> .tdd-evidence/<module>-green.log
       ```
    3. Verify exit code is 0 and the log shows the tests passing.

    ### Phase 3: Refactor (optional)
    Clean up while keeping the green log valid. If you modify the test after green,
    re-run and overwrite the green log — but DO NOT modify the red log retroactively.

    ### Hard Rules (anti-backfill)
    - **Red MUST be produced before Green.** Never re-run tests after implementation
      and save the output as a red log.
    - **Do not edit test assertions between red and green.** The test identity must be
      stable; only the implementation changes. (Reviewer diffs test content across logs.)
    - **Artifacts are append-only evidence.** If you need to redo a phase, delete BOTH
      logs and start over from red — never patch one log.
    - **Do not commit `.tdd-evidence/` without both files present for each module.**

    ### DONE Report Must Include
    When returning DONE or DONE_WITH_CONCERNS, your Report Format MUST include these
    additional fields (in addition to the standard fields):

    ```
    - COMMIT_SHA: <git commit sha>
    - PLAN_OR_REQUIREMENTS: <reference to original task>
    - TDD_TEST_FILE: tests/<module>.test.ts
    - TDD_RED_LOG: .tdd-evidence/<module>-red.log
    - TDD_GREEN_LOG: .tdd-evidence/<module>-green.log
    ```

    If you cannot produce TDD artifacts (e.g., the task is pure refactor with no
    behavior change), you MUST say so explicitly and justify it — the Spec Reviewer
    will adjudicate whether the exemption is valid.

    ## Code Organization
````

**行数净增**：约 +52 行（新段落），加 2 行空白 = 约 +54 行。

### 改动 2: 在 "Report Format" 列表内补一个 bullet（可选强化）

**old_string**:
```
    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you implemented (or what you attempted, if blocked)
    - What you tested and test results
    - Files changed
    - Self-review findings (if any)
    - Any issues or concerns
```

**new_string**:
```
    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you implemented (or what you attempted, if blocked)
    - What you tested and test results
    - Files changed
    - Self-review findings (if any)
    - Any issues or concerns
    - **TDD Artifacts** (required for DONE / DONE_WITH_CONCERNS when tests apply):
      TDD_TEST_FILE / TDD_RED_LOG / TDD_GREEN_LOG paths — see "TDD Deliverables
      Contract" above.
```

**行数净增**：+3 行。

**File 1 总计净增**：约 +57 行（从 113 → ~170 行）。

---

## File 2: spec-reviewer-prompt.md

### 改动 1: 新增 "Core Check #6: TDD Artifact Authenticity (L2)" 段落

**定位锚点**：找到 "Your Job" 段落末尾列的 "Misunderstandings" 小节之后、"Verify by reading code, not by trusting report." 之前，或在 "Verify by reading code..." 之后插入新小节。

**Edit old_string**（原文第 49-55 行附近）:
````
    **Misunderstandings:**
    - Did they interpret requirements differently than intended?
    - Did they solve the wrong problem?
    - Did they implement the right feature but wrong way?

    **Verify by reading code, not by trusting report.**

    Report:
````

**Edit new_string**:
````
    **Misunderstandings:**
    - Did they interpret requirements differently than intended?
    - Did they solve the wrong problem?
    - Did they implement the right feature but wrong way?

    **Verify by reading code, not by trusting report.**

    ## Core Check #6: TDD Artifact Authenticity (L2 Dynamic Contract)

    The implementer's DONE report MUST include TDD_TEST_FILE, TDD_RED_LOG, and
    TDD_GREEN_LOG (unless the task is explicitly exempted — a pure refactor with no
    behavior change, for example). You MUST independently verify these artifacts.
    Any failure below → REJECTED.

    ### Step 1: File existence
    - `.tdd-evidence/<module>-red.log` exists and is non-empty.
    - `.tdd-evidence/<module>-green.log` exists and is non-empty.
    - The claimed `tests/<module>.test.ts` file exists at the current HEAD.

    ### Step 2: Red log plausibility (test truly failed)
    - Read the last ~30 lines of the red log.
    - Must contain genuine assertion-failure markers: `FAIL`, `failed`, `✗`,
      `expected ... received`, `AssertionError`, or framework equivalents.
    - The log's `exit=<N>` footer must be non-zero.
    - REJECT if the "failure" is only a syntax error, unresolved import, module-not-
      found, or TypeScript compile error — those do not constitute a valid red phase.

    ### Step 3: Green log plausibility (test truly passed)
    - Read the last ~15 lines of the green log.
    - Must contain pass markers: `PASS`, `✓`, `all tests passed`, `Tests: N passed`,
      or framework equivalent.
    - The log's `exit=<N>` footer must be `exit=0`.
    - REJECT if green log is suspiciously short (< 3 lines) or lacks any per-test
      output — it may be a fabricated stub.

    ### Step 4: Test-file consistency (same test from red to green)
    - Both logs reference the SAME test file path (grep the test filename in both).
    - The test file committed at HEAD contains the same test NAMES (describe/it
      strings) that appear in both red and green logs. If a test name appears in
      green but NOT in red (or vice versa), the test suite was edited mid-flight —
      REJECT.

    ### Step 5: Anti-backfill detection
    - Red log mtime must be OLDER than green log mtime
      (`stat -c %Y .tdd-evidence/<module>-red.log` < green's mtime).
      If red is newer, it was produced AFTER the implementation — classic backfill.
    - Red log must NOT reference implementation symbols/functions that only exist
      after green. (Skim for names of functions the implementer added — if they
      appear in red log stack traces, something's wrong with the narrative.)
    - If git history is available, check: the test file was added (or the new test
      cases were added) in a commit BEFORE the implementation file changed.

    ### Step 6: Exemption adjudication
    If the implementer claims TDD exemption (e.g., "pure refactor"):
    - Verify the diff contains NO behavior change (only rename/restructure).
    - Verify existing tests still pass (the implementer must still have run them).
    - If in doubt, REJECT and require TDD artifacts.

    Any step failing → mark the review REJECTED with the specific check number and
    what's wrong. The implementer must redo the work from a genuine red phase.

    Report:
````

**行数净增**：约 +42 行。

**File 2 总计净增**：从 61 → ~103 行。

---

## File 3: code-quality-reviewer-prompt.md

**不需要改动。**

理由：code-quality-reviewer 关注代码质量维度（复用、清晰度、文件职责、过度增长等），与 TDD artifact 真实性是正交问题。TDD artifact 验证已完整归入 Spec Reviewer 的 Core Check #6，code-quality-reviewer 不必重复校验。如果 Spec Reviewer 的 check #6 失败，pipeline 在进入 code-quality 之前就会 REJECTED 终止。

（保留当前 26 行不动。）

---

## 变更总览

| 文件 | 原行数 | 新行数 | 净增 |
|------|--------|--------|------|
| implementer-prompt.md | 113 | ~170 | +57 |
| spec-reviewer-prompt.md | 61 | ~103 | +42 |
| code-quality-reviewer-prompt.md | 26 | 26 | 0 |

**核心设计理念**：
1. **写入契约、验证契约分离**：Implementer prompt 只写"必须产出什么"，Reviewer prompt 专注"如何验证产出真实"。两方独立，不互相引用内部规则。
2. **防反向填充**是最关键的设计：通过 mtime + 测试名一致性 + git 历史三层交叉验证。单一信号易伪造，三层组合成本很高。
3. **exemption 路径必须存在**：纯 refactor 无测试变化，强制 TDD 会卡死合理的任务。Reviewer 负责审查 exemption 是否正当。
