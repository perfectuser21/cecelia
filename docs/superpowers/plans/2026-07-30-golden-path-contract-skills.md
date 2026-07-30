# Golden Path Contract Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four Golden Path skills draft, attack, map, and persist the finalized seven-item GP contract.

**Architecture:** Change the `zenithjoy-skills` SSOT first. A mechanical contract linter provides the Red test and checks all four skills; each skill is then changed and verified independently. The controller passes one structured JSON sidecar through the existing proposer/reviewer loop and submits it to Brain only after convergence.

**Tech Stack:** Markdown Agent Skills, Python 3.12 CI linter, Bash/Git, GitHub Actions.

---

## File map

- Create `.github/workflows/scripts/lint-gp-contract-layer.py`: deterministic four-skill contract guard.
- Create `.github/workflows/scripts/test/test_lint_gp_contract_layer.py`: proves every missing requirement is rejected.
- Modify `.github/workflows/lint-skills.yml`: runs self-test and live guard.
- Modify `golden-path-proposer/SKILL.md`: seven-item page, JSON sidecar, NFR classification.
- Modify `golden-path-reviewer/SKILL.md`: contract attack and incident-comparison I/O.
- Modify `golden-path-mapper/SKILL.md`: GP contract → existing ledger reference discipline.
- Modify `golden-path-controller/SKILL.md`: structured contract relay and Brain submission.

### Task S1: Create the Red mechanical contract guard

**Files:**
- Create: `.github/workflows/scripts/lint-gp-contract-layer.py`
- Create: `.github/workflows/scripts/test/test_lint_gp_contract_layer.py`
- Modify: `.github/workflows/lint-skills.yml`

- [ ] **Step 1: Write the failing fixture test**

The test creates four incomplete `SKILL.md` files, runs the linter, and asserts these exact failure codes:

```python
EXPECTED = {
    "proposer:seven_contract_items",
    "proposer:nfr_classification",
    "reviewer:contract_attack",
    "reviewer:incident_comparison",
    "mapper:ledger_reference",
    "controller:contract_submission",
}
```

Then create complete fixtures containing the required markers and assert exit code 0.

- [ ] **Step 2: Run the fixture test and verify Red**

Run:

```bash
python3 .github/workflows/scripts/test/test_lint_gp_contract_layer.py
```

Expected: FAIL because `lint-gp-contract-layer.py` does not exist.

- [ ] **Step 3: Implement the linter**

Use this rule table:

```python
RULES = {
    "golden-path-proposer/SKILL.md": {
        "proposer:seven_contract_items": [
            "fr_summary", "lifelines_and_nfr", "yield_order",
            "external_commitment_changes", "release_and_blast_radius",
            "success_and_close", "budget_guard",
        ],
        "proposer:nfr_classification": ["lifeline", "best_effort", "gp-contract-v<N>.json"],
    },
    "golden-path-reviewer/SKILL.md": {
        "reviewer:contract_attack": ["GP_CONTRACT", "contract_attack"],
        "reviewer:incident_comparison": ["INCIDENT_CONTEXT", "incident_comparison", "unavailable"],
    },
    "golden-path-mapper/SKILL.md": {
        "mapper:ledger_reference": ["golden_paths.journey_id", "journey_step_links", "禁止复制合同正文"],
    },
    "golden-path-controller/SKILL.md": {
        "controller:contract_submission": [
            "gp-contract-v<N>.json",
            "/golden-paths/$GP_ID/contracts",
            "pending_action_id",
        ],
    },
}
```

The CLI accepts an optional root path, prints `<failure-code>: missing <marker>`, and exits 1 if any rule fails.

- [ ] **Step 4: Run fixture tests Green, then run live guard Red**

Run:

```bash
python3 .github/workflows/scripts/test/test_lint_gp_contract_layer.py
python3 .github/workflows/scripts/lint-gp-contract-layer.py
```

Expected: fixture PASS; live guard FAIL with all six requirement groups missing.

- [ ] **Step 5: Wire CI and commit the Red test**

Add after the existing lint-skills self-test:

```yaml
- name: Self-test — GP 合同层守卫
  run: python3 .github/workflows/scripts/test/test_lint_gp_contract_layer.py

- name: GP 合同层 Skill 守卫
  run: python3 .github/workflows/scripts/lint-gp-contract-layer.py
```

Commit:

```bash
git add .github/workflows/lint-skills.yml .github/workflows/scripts/lint-gp-contract-layer.py .github/workflows/scripts/test/test_lint_gp_contract_layer.py
git commit -m "test(golden-path): add contract-layer skill guard"
```

### Task S2: Upgrade proposer

**Files:**
- Modify: `golden-path-proposer/SKILL.md`

- [ ] **Step 1: Confirm proposer remains Red**

Run the live guard. Expected failures include:

```text
proposer:seven_contract_items
proposer:nfr_classification
```

- [ ] **Step 2: Add the minimal proposer contract**

Bump version `1.2.0 → 1.3.0`. Add inputs:

```text
GLOBAL_YIELD_ORDER — 全局让路顺序；未覆盖时使用最终 PRD 默认值
```

Add two required outputs:

```text
<SPRINT_DIR>/proposal-v<N>.md
.harness/gp-contract-v<N>.json
```

The JSON top level must contain exactly:

```json
{
  "fr_summary": {},
  "lifelines_and_nfr": {},
  "yield_order": {},
  "external_commitment_changes": {},
  "release_and_blast_radius": {},
  "success_and_close": {},
  "budget_guard": {}
}
```

Require every NFR to include `class=lifeline|best_effort`, verification, and rationale. Add an explicit prohibition on an eighth business key and on moving the 11 step elements into this object.

- [ ] **Step 3: Run the guard**

Expected: proposer failures disappear; reviewer/mapper/controller remain Red.

- [ ] **Step 4: Commit**

```bash
git add golden-path-proposer/SKILL.md
git commit -m "feat(golden-path): draft seven-item GP contracts"
```

### Task S3: Upgrade reviewer

**Files:**
- Modify: `golden-path-reviewer/SKILL.md`

- [ ] **Step 1: Confirm reviewer Red**

Expected:

```text
reviewer:contract_attack
reviewer:incident_comparison
```

- [ ] **Step 2: Add reviewer input and verdict shape**

Bump version `1.2.0 → 1.3.0`. Add:

```text
GP_CONTRACT      — .harness/gp-contract-v<N>.json
INCIDENT_CONTEXT — 事故/客诉/返工输入；§④ 前允许精确值 unavailable
```

Extend verdict JSON without changing the existing seven rubric keys:

```json
{
  "contract_attack": {
    "verdict": "PASS|REVISION",
    "findings": []
  },
  "incident_comparison": {
    "evidence_status": "available|unavailable",
    "matched_incidents": [],
    "missing_contract_terms": []
  }
}
```

Require Red-team checks for vague FR, missed lifelines, yield-order conflict, external commitment drift, missing rollback, vanity metrics, and budget escape. `unavailable` must never be translated to “无事故”.

- [ ] **Step 3: Run the guard and existing lint**

Run:

```bash
python3 .github/workflows/scripts/lint-gp-contract-layer.py
python3 .github/workflows/scripts/lint-skills.py
```

Expected: reviewer failures disappear; lint-skills PASS.

- [ ] **Step 4: Commit**

```bash
git add golden-path-reviewer/SKILL.md
git commit -m "feat(golden-path): red-team GP contracts and incidents"
```

### Task S4: Upgrade mapper

**Files:**
- Modify: `golden-path-mapper/SKILL.md`

- [ ] **Step 1: Confirm mapper Red**

Expected: `mapper:ledger_reference`.

- [ ] **Step 2: Add the reference discipline**

Bump version `1.1.0 → 1.2.0`. After map approval require:

```text
1. golden_paths.journey_id 必须指向该领域 Journey；
2. GP 合同通过 golden_path_id → golden_paths.journey_id → journey_step_links 引用格子账本；
3. 7 项合同是 GP 级签字面；11 要素、场景和断言仍只写 journey_step_links；
4. 禁止复制合同正文或新建平行账本，禁止修改 journey_step_links 表结构。
```

- [ ] **Step 3: Run the guard**

Expected: mapper failure disappears; only controller remains Red.

- [ ] **Step 4: Commit**

```bash
git add golden-path-mapper/SKILL.md
git commit -m "feat(golden-path): bind contracts to the existing ledger"
```

### Task S5: Upgrade controller

**Files:**
- Modify: `golden-path-controller/SKILL.md`

- [ ] **Step 1: Confirm controller Red**

Expected: `controller:contract_submission`.

- [ ] **Step 2: Add structured relay and submission**

Bump version `1.0.0 → 1.1.0`. Amend the flow:

```text
Step 2 proposer → proposal-vN.md + gp-contract-vN.json
Step 3/4 reviewer → always receives GP_CONTRACT + INCIDENT_CONTEXT
Step 6 → submit contract JSON, then PATCH proposal/status
Step 6.5 → stop at pending Owner signature
```

Use this exact submission:

```bash
CONTRACT_RESPONSE=$(curl -sf -X POST \
  "$BRAIN/api/brain/golden-paths/$GP_ID/contracts" \
  -H "Content-Type: application/json" \
  --data-binary "@.harness/gp-contract-v<N>.json")
PENDING_ACTION_ID=$(printf '%s' "$CONTRACT_RESPONSE" | jq -er '.pending_action_id')
```

Require `contract_attack.verdict=PASS`; require `incident_comparison` to exist, while `evidence_status=unavailable` remains allowed until §④. After receiving `pending_action_id`, report it and stop; never approve it as Owner.

- [ ] **Step 3: Run all Skill checks**

Run:

```bash
python3 .github/workflows/scripts/test/test_lint_gp_contract_layer.py
python3 .github/workflows/scripts/lint-gp-contract-layer.py
python3 .github/workflows/scripts/test/test_lint_skills.py
python3 .github/workflows/scripts/lint-skills.py
bash .github/workflows/scripts/check-brain-contract.sh
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add golden-path-controller/SKILL.md
git commit -m "feat(golden-path): submit converged GP contracts"
```

### Task S6: Publish PR-S

- [ ] **Step 1: Review scope**

Run:

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
```

Expected: only the seven files in this plan.

- [ ] **Step 2: Push and open PR**

Use a `cp-*` branch and title:

```text
feat(golden-path): add seven-item GP contract skills
```

Include in the PR body: design link, Red evidence, Green commands, and “§③/§④ not included”.

- [ ] **Step 3: Wait for latest-SHA checks and squash merge**

Required check: `lint-skills`. After merge, record the SSOT merge SHA for PR-C snapshot sync.
