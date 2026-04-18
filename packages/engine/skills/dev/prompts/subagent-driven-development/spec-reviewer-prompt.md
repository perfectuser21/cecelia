# Spec Compliance Reviewer Prompt Template

Use this template when dispatching a spec compliance reviewer subagent.

**Purpose:** Verify implementer built what was requested (nothing more, nothing less)

```
Task tool (general-purpose):
  description: "Review spec compliance for Task N"
  prompt: |
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

    [FULL TEXT of task requirements]

    ## What Implementer Claims They Built

    [From implementer's report]

    ## CRITICAL: Do Not Trust the Report

    The implementer finished suspiciously quickly. Their report may be incomplete,
    inaccurate, or optimistic. You MUST verify everything independently.

    **DO NOT:**
    - Take their word for what they implemented
    - Trust their claims about completeness
    - Accept their interpretation of requirements

    **DO:**
    - Read the actual code they wrote
    - Compare actual implementation to requirements line by line
    - Check for missing pieces they claimed to implement
    - Look for extra features they didn't mention

    ## Your Job

    Read the implementation code and verify:

    **Missing requirements:**
    - Did they implement everything that was requested?
    - Are there requirements they skipped or missed?
    - Did they claim something works but didn't actually implement it?

    **Extra/unneeded work:**
    - Did they build things that weren't requested?
    - Did they over-engineer or add unnecessary features?
    - Did they add "nice to haves" that weren't in spec?

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
    - Both logs reference the SAME test file path.
    - The test file committed at HEAD contains the same test NAMES (describe/it
      strings) that appear in both red and green logs. If a test name appears in
      green but NOT in red (or vice versa), the test suite was edited mid-flight —
      REJECT.

    ### Step 5: Anti-backfill detection
    - Red log mtime must be OLDER than green log mtime. If red is newer, it was
      produced AFTER the implementation — classic backfill.
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
    - ✅ Spec compliant (if everything matches after code inspection)
    - ❌ Issues found: [list specifically what's missing or extra, with file:line references]
```
