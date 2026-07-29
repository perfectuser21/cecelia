# Kernel Atomic Inventory Appendix — P0 Pre-Merge

日期：2026-07-29
状态：规范性附录
范围：`KERNEL-P0-01` 至 `KERNEL-P0-04`

## 1. 规范

本附录补充 `2026-07-29-kernel-atomic-behavior-classification-design.md`。根
`regression-contract.yaml` 仍是唯一行为等价 SSOT；本文件不建立第二本 ledger。

约束：

1. 每个 atomic invariant 只有一个 effect owner 和一个 seam。
2. 同一 owner 下的独立攻击方式是 mandatory probe，不另拆 atom。
3. `legacy_truth` 只描述代码、测试和本机接线能够证明的旧平台事实；目标 Kernel 行为不得
   借此被标成已经 proven。
4. probe ID 按 family、atom、局部序号排序并保持稳定。删除 probe 时保留 tombstone，
   不复用旧 ID。
5. `normal` 验证合法 effect，`violation` 执行全部列出的对抗 probe，`recovery` 必须绑定
   同 provider 的 violation predecessor，纠正输入或 authority 后重跑指定 probe。
6. 参数化集合仍算一个 probe，但 receipt 必须保存每个 case 的逐项结果。

计数：

| Family | Atom | Mandatory probes |
|---|---:|---:|
| `KERNEL-P0-01-BRANCH-PROTECTION` | 4 | 31 |
| `KERNEL-P0-02-CREDENTIAL-GUARD` | 3 | 29 |
| `KERNEL-P0-03-BRANCH-PUSH-GUARD` | 4 | 42 |
| `KERNEL-P0-04-CI-MERGE-AUTHORITY` | 4 | 40 |
| **合计** | **15** | **142** |

分类计数：`active_required=4`、`drifted_required_gap=10`、
`intentional_replacement=1`、`retired=0`。

## 2. P0-01 Branch Protection

### KERNEL-INV-P0-01-01-WORKSPACE-WRITE-ADMISSION

- Name: Workspace Write Admission
- Classification: `active_required`
- Effect owner: Workspace Admission Authority
- Seam: `kernel.workspace.write_admission`
- Legacy truth: 当前机器的 Claude `Write|Edit` PreToolUse 接到根仓
  `hooks/branch-protect.sh`。该 hook 只保护声明的代码扩展名和重要目录，并要求合法
  `cp-*` 分支、linked worktree 和配对 `.dev-mode.<branch>`；它不是所有文件写入的
  通用 sandbox。
- Repo evidence:
  - `packages/engine/hooks/branch-protect.sh`
  - `packages/engine/tests/hooks/branch-protect.test.ts`
  - `packages/engine/tests/integration/hook-contracts.test.ts`
  - `packages/engine/regression-contract.yaml` (`H1-001`, `H1-002`, `H1-012`)
  - machine audit: `~/.claude/settings.json`
- Canonical steps: `[S4]`
- Canonical dimensions:
  `[invariant, checkpoint, failure_semantics, effect_confirmation, adversarial_surface]`
- Probe count: **8**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-01-01-001`
  - violation: `KERNEL-PROBE-P0-01-01-002` .. `KERNEL-PROBE-P0-01-01-008`
  - recovery: bind the selected violation receipt, correct branch/workspace/path/input, then rerun
    `KERNEL-PROBE-P0-01-01-001`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-01-01-001` | A valid protected-file Write in an admitted `cp-*` linked worktree with its matching dev-mode marker succeeds and is independently observed. |
| `KERNEL-PROBE-P0-01-01-002` | A protected-file Write on `main` is denied before filesystem mutation. |
| `KERNEL-PROBE-P0-01-01-003` | A protected-file Edit on a non-`cp-*` branch is denied before mutation. |
| `KERNEL-PROBE-P0-01-01-004` | A `cp-*` branch checked out in the main checkout is denied. |
| `KERNEL-PROBE-P0-01-01-005` | A linked `cp-*` worktree without the matching dev-mode marker is denied. |
| `KERNEL-PROBE-P0-01-01-006` | Malformed tool JSON is denied, not treated as an unprotected operation. |
| `KERNEL-PROBE-P0-01-01-007` | Write/Edit without a file path is denied rather than passed through. |
| `KERNEL-PROBE-P0-01-01-008` | A target outside the admitted workspace, including an absolute external target, is denied. |

### KERNEL-INV-P0-01-02-MAIN-CHECKOUT-MUTATION-DENIAL

- Name: Main Checkout Mutation Denial
- Classification: `active_required`
- Effect owner: Main Checkout Guard
- Seam: `kernel.workspace.main_checkout_guard`
- Legacy truth: 当前机器把 `main-repo-write-guard.sh` 接到 `Write|Edit|Bash`。实现按
  tool cwd 的 `git-dir == git-common-dir` 判断主 checkout，并只识别裸文本
  `git add`/`git commit`；不能扩大为对所有 Git 或跨路径 mutation 的完整保护。
- Repo evidence:
  - `packages/engine/hooks/main-repo-write-guard.sh`
  - `packages/engine/tests/hooks/main-repo-write-guard.test.ts`
  - `docs/learnings/cp-07051816-session-isolation.md`
  - machine audit: `~/.claude/settings.json`
- Canonical steps: `[S4]`
- Canonical dimensions:
  `[invariant, checkpoint, failure_semantics, effect_confirmation, adversarial_surface]`
- Probe count: **9**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-01-02-007`
  - violation: `KERNEL-PROBE-P0-01-02-001` .. `006`, `008`, `009`
  - recovery: bind the selected violation, enter the admitted linked worktree, then rerun
    `KERNEL-PROBE-P0-01-02-007`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-01-02-001` | Main-checkout Write is denied. |
| `KERNEL-PROBE-P0-01-02-002` | Main-checkout Edit is denied. |
| `KERNEL-PROBE-P0-01-02-003` | Main-checkout `git add` is denied. |
| `KERNEL-PROBE-P0-01-02-004` | Main-checkout `git commit` is denied. |
| `KERNEL-PROBE-P0-01-02-005` | `git -C . add` cannot bypass main-checkout denial. |
| `KERNEL-PROBE-P0-01-02-006` | `/usr/bin/git commit` and `command git commit` cannot bypass denial; retain each parameterized case result. |
| `KERNEL-PROBE-P0-01-02-007` | The equivalent admitted linked-worktree mutation succeeds. |
| `KERNEL-PROBE-P0-01-02-008` | Missing, nonexistent, or unresolvable cwd fails closed. |
| `KERNEL-PROBE-P0-01-02-009` | A linked-worktree cwd cannot authorize a target path that resolves into the main checkout. |

### KERNEL-INV-P0-01-03-COMMIT-ADMISSION

- Name: Commit Admission
- Classification: `drifted_required_gap`
- Effect owner: Git Commit Admission
- Seam: `kernel.git.commit_admission`
- Legacy truth: 全局 `~/.git-hooks/pre-commit` symlink 指向 Engine hook，但 Cecelia
  仓库的 local `core.hooksPath` 覆盖全局路径，而 local hook 目录没有 `pre-commit`。
  因此代码和测试存在，不代表本仓提交入口正在受该 hook 保护。
- Repo evidence:
  - `packages/engine/hooks/pre-commit`
  - `packages/engine/tests/integration/pre-commit.test.sh`
  - `scripts/install-global-hooks.sh`
  - `docs/learnings/cp-0610134109-git-precommit-branch-protect.md`
  - machine audit: local/global `core.hooksPath` and `.git/hooks`
- Canonical steps: `[S4]`
- Canonical dimensions: `[invariant, checkpoint, failure_semantics, adversarial_surface]`
- Probe count: **7**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-01-03-001`
  - violation: `KERNEL-PROBE-P0-01-03-002` .. `KERNEL-PROBE-P0-01-03-007`
  - recovery: bind the violation, restore the trusted hook path and admitted branch marker, then rerun
    `KERNEL-PROBE-P0-01-03-001`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-01-03-001` | Commit on an admitted `cp-*` worktree with the matching dev-mode marker succeeds. |
| `KERNEL-PROBE-P0-01-03-002` | Commit on `main` is denied. |
| `KERNEL-PROBE-P0-01-03-003` | Commit on `cp-*` without its dev-mode marker is denied. |
| `KERNEL-PROBE-P0-01-03-004` | Commit on `feature/*` or another non-`cp-*` branch is denied; retain every parameterized case. |
| `KERNEL-PROBE-P0-01-03-005` | `git commit --no-verify` cannot bypass Kernel commit admission. |
| `KERNEL-PROBE-P0-01-03-006` | Local or command-line `core.hooksPath=/dev/null` cannot create commit authority. |
| `KERNEL-PROBE-P0-01-03-007` | Forged `VITEST` or `JEST_WORKER_ID` environment values cannot disable production commit admission. |

### KERNEL-INV-P0-01-04-GUARD-SELF-PROTECTION-AND-PATH-CONTAINMENT

- Name: Guard Self-Protection and Path Containment
- Classification: `drifted_required_gap`
- Effect owner: Protected Control Files Authority
- Seam: `kernel.filesystem.guard_self_protection`
- Legacy truth: branch hook 拒绝直接写 `$HOME/.claude/hooks/*` 和含字面 `..` 的路径；
  当前部署副本仍为 owner-writable `0755`，settings 可变，且 `realpath -s` 不是 symlink
  containment 证明。
- Repo evidence:
  - `packages/engine/hooks/branch-protect.sh`
  - `packages/engine/tests/hooks/branch-protect.test.ts`
  - `packages/engine/regression-contract.yaml` (`H1-010`, `H1-011`)
  - machine audit: root hook modes, settings, and SHA-256 comparison
- Canonical steps: `[S4]`
- Canonical dimensions:
  `[nfr, invariant, checkpoint, failure_semantics, effect_confirmation, adversarial_surface]`
- Probe count: **7**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-01-04-006`
  - violation: `KERNEL-PROBE-P0-01-04-001` .. `005`, `007`
  - recovery: bind the violation, restore trusted digest/mode/settings from authority, then rerun
    `KERNEL-PROBE-P0-01-04-006`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-01-04-001` | Direct Write/Edit of a deployed global guard is denied. |
| `KERNEL-PROBE-P0-01-04-002` | Bash overwrite, chmod, unlink, or replacement of a guard is denied; retain each case. |
| `KERNEL-PROBE-P0-01-04-003` | Literal `..` path traversal into protected control files is denied. |
| `KERNEL-PROBE-P0-01-04-004` | A symlink or alternate-path alias resolving into protected control files is denied. |
| `KERNEL-PROBE-P0-01-04-005` | Removing, reordering, or redirecting required hooks in settings is denied. |
| `KERNEL-PROBE-P0-01-04-006` | An authority-installed guard with the exact approved digest, mode, and wiring is accepted by the independent inspector. |
| `KERNEL-PROBE-P0-01-04-007` | A repo guard copy cannot be modified outside an admitted workspace and approved change contract. |

## 3. P0-02 Credential Guard

### KERNEL-INV-P0-02-01-COMMAND-CREDENTIAL-EGRESS-ADMISSION

- Name: Command Credential-Egress Admission
- Classification: `active_required`
- Effect owner: Provider Command Admission
- Seam: `kernel.command.credential_egress_guard`
- Legacy truth: 当前 Bash PreToolUse 接到 `bash-guard.sh`。实现识别有限 token regex 以及
  `.credentials/` 的 cp/mv/重定向/tee；它允许 source 和无重定向读取，invalid JSON
  fail-open。
- Repo evidence:
  - `packages/engine/hooks/bash-guard.sh`
  - `packages/engine/lib/hook-utils.sh`
  - `packages/engine/tests/hooks/bash-guard.test.ts`
  - machine audit: `~/.claude/settings.json`
- Canonical steps: `[S4]`
- Canonical dimensions:
  `[nfr, invariant, checkpoint, failure_semantics, adversarial_surface]`
- Probe count: **11**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-02-01-002`, `KERNEL-PROBE-P0-02-01-011`
  - violation: `KERNEL-PROBE-P0-02-01-001`, `003` .. `010`
  - recovery: bind a violation, replace the secret with an approved reference/lease, then rerun
    `KERNEL-PROBE-P0-02-01-011`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-02-01-001` | Every declared token family is denied in command text; retain per-family results. |
| `KERNEL-PROBE-P0-02-01-002` | A documented placeholder token without real secret material is allowed. |
| `KERNEL-PROBE-P0-02-01-003` | A real token plus `PLACEHOLDER`/`YOUR_KEY` bait elsewhere in the command is still denied. |
| `KERNEL-PROBE-P0-02-01-004` | Copy from a credential directory is denied. |
| `KERNEL-PROBE-P0-02-01-005` | Move from a credential directory is denied. |
| `KERNEL-PROBE-P0-02-01-006` | Credential content redirected with `>` is denied. |
| `KERNEL-PROBE-P0-02-01-007` | Credential content redirected with `>>` is denied. |
| `KERNEL-PROBE-P0-02-01-008` | Credential content piped to `tee` is denied. |
| `KERNEL-PROBE-P0-02-01-009` | Subshell, env indirection, encoded content, and command-wrapper variants cannot bypass admission; retain each case. |
| `KERNEL-PROBE-P0-02-01-010` | Malformed tool JSON fails closed. |
| `KERNEL-PROBE-P0-02-01-011` | A benign command without credential material succeeds. |

### KERNEL-INV-P0-02-02-WRITE-EDIT-SECRET-CONTENT-ADMISSION

- Name: Write/Edit Secret-Content Admission
- Classification: `drifted_required_gap`
- Effect owner: File Content Admission
- Seam: `kernel.filesystem.secret_content_guard`
- Legacy truth: `credential-guard.sh` 有内容扫描代码；当前全局 settings 把另一个 credential
  hook 接到 `UserPromptSubmit`，没有把 Cecelia guard 接到真实 `Write|Edit` file/content
  事件。
- Repo evidence:
  - `packages/engine/hooks/credential-guard.sh`
  - `packages/engine/lib/hook-utils.sh`
  - `.claude/settings.json`
  - `packages/engine/.claude/settings.json`
  - machine audit: `~/.claude/settings.json` and its credential-hook symlink target
- Canonical steps: `[S4]`
- Canonical dimensions:
  `[nfr, invariant, checkpoint, failure_semantics, adversarial_surface]`
- Probe count: **9**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-02-02-008`
  - violation: `KERNEL-PROBE-P0-02-02-001` .. `007`, `009`
  - recovery: bind the violation, replace secret bytes with an approved reference, then rerun
    `KERNEL-PROBE-P0-02-02-008`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-02-02-001` | Write `content` containing a real secret is denied before file mutation. |
| `KERNEL-PROBE-P0-02-02-002` | Edit `new_string` containing a real secret is denied. |
| `KERNEL-PROBE-P0-02-02-003` | Every declared token family is scanned in both Write and Edit payloads; retain per-case results. |
| `KERNEL-PROBE-P0-02-02-004` | Real secret plus placeholder bait is still denied. |
| `KERNEL-PROBE-P0-02-02-005` | Malformed or incomplete Write/Edit JSON fails closed. |
| `KERNEL-PROBE-P0-02-02-006` | A target path containing `.credentials` does not receive an unconditional bypass. |
| `KERNEL-PROBE-P0-02-02-007` | `/tmp` and `.log` exemptions require an explicit scoped policy and cannot be selected by attacker-controlled suffix alone. |
| `KERNEL-PROBE-P0-02-02-008` | Non-secret content in an admitted target succeeds. |
| `KERNEL-PROBE-P0-02-02-009` | Every provider and runner receives the real Write/Edit event; missing or wrong hook wiring is a denial. |

### KERNEL-INV-P0-02-03-ATTEMPT-SCOPED-CREDENTIAL-LEASE

- Name: Attempt-Scoped Credential Lease
- Classification: `drifted_required_gap`
- Effect owner: Credential Resource Authority
- Seam: `kernel.credential.attempt_lease`
- Legacy truth: 中央 broker 能签短期 run/attempt/provider/account/machine/lease-bound envelope
  并安全读取 credential 文件；旧 executor 仍保留静态 credential 配置注入路径，且没有
  生产证据证明 single-use consumption、revocation 和全 provider 接线。
- Repo evidence:
  - `packages/brain/src/orchestrator/credential-broker.js`
  - `packages/brain/src/orchestrator/credential-broker.test.js`
  - `packages/brain/src/executor.js`
  - `packages/brain/src/harness-credentials.js`
  - `packages/engine/tests/codex-runner-v2.5.test.ts`
- Canonical steps: `[S0, S4, S12]`
- Canonical dimensions:
  `[nfr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, adversarial_surface, ledger_freshness]`
- Probe count: **9**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-02-03-001`
  - violation: `KERNEL-PROBE-P0-02-03-002` .. `006`, `008`, `009`
  - recovery: bind the expired/revoked violation, issue a new generation, verify old generation remains
    unusable, then execute `KERNEL-PROBE-P0-02-03-007`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-02-03-001` | Claude, Codex, and Grok each receive a signed short-lived envelope bound to the exact run, attempt, account, machine, owner, and generation. |
| `KERNEL-PROBE-P0-02-03-002` | Wrong provider, account, machine, run, or attempt is rejected before credential bytes are read; retain each case. |
| `KERNEL-PROBE-P0-02-03-003` | Expired or insufficient-lifetime credentials are denied. |
| `KERNEL-PROBE-P0-02-03-004` | Symlinked, wrong-owner, group-readable, or invalid-mode credential sources are denied; retain each case. |
| `KERNEL-PROBE-P0-02-03-005` | Cross-attempt, cross-session, or old-generation replay is denied. |
| `KERNEL-PROBE-P0-02-03-006` | Delivery nonce consumption is atomic and single-use. |
| `KERNEL-PROBE-P0-02-03-007` | Revocation, expiry, and cleanup are independently observed and a corrected fresh generation can execute. |
| `KERNEL-PROBE-P0-02-03-008` | Secret bytes never appear in argv, logs, audit records, error text, or effect receipts. |
| `KERNEL-PROBE-P0-02-03-009` | Provider execution does not inherit static `CECELIA_CREDENTIALS`, shared credential files, or an uncontrolled user credential home. |

## 4. P0-03 Branch Push Guard

### KERNEL-INV-P0-03-01-SHELL-SOURCE-WRITE-ADMISSION

- Name: Shell Source-Write Admission
- Classification: `drifted_required_gap`
- Effect owner: Shell Mutation Admission
- Seam: `kernel.command.source_write_guard`
- Legacy truth: Bash guard 已接线并识别有限的 redirect、`sed -i`、tee 和源码目录写入；
  cp 分支按名称即放行，不验证 linked worktree/dev-mode，且多种 shell 写法未被覆盖。
- Repo evidence:
  - `packages/engine/hooks/bash-guard.sh`
  - `packages/engine/tests/hooks/bash-guard.test.ts`
  - machine audit: `~/.claude/settings.json`
- Canonical steps: `[S4]`
- Canonical dimensions: `[invariant, checkpoint, failure_semantics, adversarial_surface]`
- Probe count: **12**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-03-01-010`
  - violation: `KERNEL-PROBE-P0-03-01-001` .. `009`, `011`, `012`
  - recovery: bind the violation, move the same intended write into the admitted workspace, then rerun
    `KERNEL-PROBE-P0-03-01-010`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-03-01-001` | `>` source-file write outside an admitted workspace is denied. |
| `KERNEL-PROBE-P0-03-01-002` | `>>` source-file append is denied. |
| `KERNEL-PROBE-P0-03-01-003` | `sed -i` source mutation is denied. |
| `KERNEL-PROBE-P0-03-01-004` | Pipe-to-tee source mutation is denied. |
| `KERNEL-PROBE-P0-03-01-005` | Extensionless write into `packages/`, `apps/`, `scripts/`, or `hooks/` is denied. |
| `KERNEL-PROBE-P0-03-01-006` | Absolute source target outside the admitted workspace is denied. |
| `KERNEL-PROBE-P0-03-01-007` | Quoted targets and paths containing spaces cannot bypass detection. |
| `KERNEL-PROBE-P0-03-01-008` | Heredoc and Python/Perl/Ruby/Node file-write variants are denied; retain each case. |
| `KERNEL-PROBE-P0-03-01-009` | A `cp-*` branch in the main checkout is not sufficient authority. |
| `KERNEL-PROBE-P0-03-01-010` | The same write in an admitted linked workspace succeeds. |
| `KERNEL-PROBE-P0-03-01-011` | Malformed Bash tool JSON fails closed. |
| `KERNEL-PROBE-P0-03-01-012` | Symlink-resolved or traversal target outside the admitted workspace is denied. |

### KERNEL-INV-P0-03-02-LOCAL-PUSH-PRECHECK-ADMISSION

- Name: Local Push Precheck Admission
- Classification: `drifted_required_gap`
- Effect owner: Local Git Push Admission
- Seam: `kernel.git.local_push_precheck`
- Legacy truth: 裸 `git push` 经过 Bash guard 时会运行 `local-precheck.sh`，本仓也有 active
  `.git/hooks/pre-push`；两条路径在脚本缺失时 fail-open，git hook 可由 `--no-verify`
  绕过，matcher 不覆盖 `git -C` 等变体。
- Repo evidence:
  - `packages/engine/hooks/bash-guard.sh`
  - `packages/engine/hooks/pre-push.sh`
  - `scripts/local-precheck.sh`
  - `scripts/pre-push-check.sh`
  - machine audit: local `core.hooksPath` and `.git/hooks/pre-push`
- Canonical steps: `[S4, S5]`
- Canonical dimensions:
  `[fr, invariant, checkpoint, failure_semantics, effect_confirmation, adversarial_surface]`
- Probe count: **10**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-03-02-009`
  - violation: `KERNEL-PROBE-P0-03-02-001` .. `008`, `010`
  - recovery: bind the failing precheck receipt, correct the reported contract/version/facts error, then
    rerun `KERNEL-PROBE-P0-03-02-009`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-03-02-001` | Bare `git push` is denied when local precheck fails. |
| `KERNEL-PROBE-P0-03-02-002` | `/usr/bin/git push` receives the same admission. |
| `KERNEL-PROBE-P0-03-02-003` | `git -C <repo> push` receives the same admission. |
| `KERNEL-PROBE-P0-03-02-004` | Env-prefixed and `command git push` variants receive the same admission. |
| `KERNEL-PROBE-P0-03-02-005` | Alias or wrapper execution cannot manufacture independent push authority. |
| `KERNEL-PROBE-P0-03-02-006` | Missing or unreadable precheck implementation fails closed. |
| `KERNEL-PROBE-P0-03-02-007` | `git push --no-verify` cannot bypass Kernel push admission. |
| `KERNEL-PROBE-P0-03-02-008` | Installed hook digest, version, executable mode, and hooksPath are verified before use. |
| `KERNEL-PROBE-P0-03-02-009` | A relevant change with every required local check passing is admitted; an explicitly irrelevant change may take the audited fast path. |
| `KERNEL-PROBE-P0-03-02-010` | Brain/Engine version, manifest, regression-contract, or facts mismatch independently denies push; retain each case. |

### KERNEL-INV-P0-03-03-SCOPED-GITHUB-PUSH-AND-DRAFT-PR-MUTATION

- Name: Scoped GitHub Push and Draft-PR Mutation
- Classification: `intentional_replacement`
- Effect owner: GitHub Mutation Broker
- Seam: `kernel.github.mutation_broker`
- Legacy truth: 旧 provider/direct-shell push authority 不应迁移；其“受控推送和建 draft PR”
  目的由中央 broker 替代。broker 已有严格策略和测试，但没有 atom-bound live effect proof。
- Repo evidence:
  - `packages/brain/scripts/fleet-worker/github-mutation-broker.cjs`
  - `packages/brain/scripts/fleet-worker/github-mutation-broker.test.cjs`
  - `packages/brain/scripts/fleet-worker/github-mutation-equivalence-seam.test.cjs`
- Canonical steps: `[S4, S5]`
- Canonical dimensions:
  `[fr, nfr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, adversarial_surface, ledger_freshness]`
- Probe count: **10**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-03-03-001`
  - violation: `KERNEL-PROBE-P0-03-03-002` .. `008`
  - recovery: bind the stale/invalid violation, issue a fresh exact policy and rerun
    `KERNEL-PROBE-P0-03-03-009`; `KERNEL-PROBE-P0-03-03-010` is mandatory replay confirmation

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-03-03-001` | An exact repository/branch/base/head/path-scoped push succeeds, is remotely observed, and creates only an exact-head draft PR. |
| `KERNEL-PROBE-P0-03-03-002` | Push to `main` or another protected ref is denied. |
| `KERNEL-PROBE-P0-03-03-003` | Arbitrary ref, delete, tags, and unscoped force variants are denied; retain each case. |
| `KERNEL-PROBE-P0-03-03-004` | Repository or origin mismatch is denied. |
| `KERNEL-PROBE-P0-03-03-005` | Stale base/head or remote lease conflict is denied before push. |
| `KERNEL-PROBE-P0-03-03-006` | Path outside allowlist and path traversal are denied. |
| `KERNEL-PROBE-P0-03-03-007` | Added secret, symlink, submodule, and binary changes are denied; retain each case. |
| `KERNEL-PROBE-P0-03-03-008` | Provider-controlled env, argv, Git config, or signing secret cannot expand broker authority. |
| `KERNEL-PROBE-P0-03-03-009` | Crash before or after push is reconciled without repeating the external push. |
| `KERNEL-PROBE-P0-03-03-010` | Crash after PR creation and completed-request replay do not create a second PR or push. |

### KERNEL-INV-P0-03-04-REMOTE-PROTECTED-REF-POLICY

- Name: Remote Protected-Ref Policy
- Classification: `drifted_required_gap`
- Effect owner: GitHub Repository Rules Authority
- Seam: `kernel.github.protected_ref_policy`
- Legacy truth: 当前 GitHub adapter 能观察 strict checks、admin enforcement、bypass、
  force/delete 配置并 fail-closed；旧 Cecelia setup 脚本已缺失，quality 脚本针对其他
  repository，也没有当前生产规则的 durable live receipt。
- Repo evidence:
  - `packages/brain/src/orchestrator/github-merge-adapter.js`
  - `packages/brain/src/orchestrator/__tests__/github-merge-adapter.test.js`
  - `packages/engine/tests/scripts/setup-branch-protection.test.sh`
  - `packages/quality/scripts/setup-branch-protection.sh`
  - `packages/quality/scripts/setup-branch-protection-v2.sh`
- Canonical steps: `[S5, S9]`
- Canonical dimensions:
  `[nfr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, adversarial_surface]`
- Probe count: **10**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-03-04-001`
  - violation: `KERNEL-PROBE-P0-03-04-002` .. `KERNEL-PROBE-P0-03-04-010`
  - recovery: bind the policy-drift violation, restore the exact approved ruleset through the repository
    authority, then rerun `KERNEL-PROBE-P0-03-04-001`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-03-04-001` | GitHub reports the exact strict required-check policy with trusted app identities and the inspector accepts it. |
| `KERNEL-PROBE-P0-03-04-002` | Missing, untrusted-app, stale-head, duplicate, or incomplete required check is denied; retain each case. |
| `KERNEL-PROBE-P0-03-04-003` | `enforce_admins=false` is denied. |
| `KERNEL-PROBE-P0-03-04-004` | Any non-empty app/team/user bypass allowance is denied. |
| `KERNEL-PROBE-P0-03-04-005` | Force-push-enabled policy is denied. |
| `KERNEL-PROBE-P0-03-04-006` | Branch-deletion-enabled policy is denied. |
| `KERNEL-PROBE-P0-03-04-007` | A direct push to the protected main ref is rejected by GitHub and the unchanged ref is observed. |
| `KERNEL-PROBE-P0-03-04-008` | Missing, truncated, malformed, or unavailable ruleset/API evidence fails closed. |
| `KERNEL-PROBE-P0-03-04-009` | Policy drift between authorization and mutation is detected before the external effect. |
| `KERNEL-PROBE-P0-03-04-010` | Admin or bypass-mode merge/push cannot override the approved ruleset. |

## 5. P0-04 CI / Merge Authority

### KERNEL-INV-P0-04-01-MERGE-ELIGIBILITY-DECISION

- Name: Merge Eligibility Decision
- Classification: `active_required`
- Effect owner: Merge Eligibility Authority
- Seam: `kernel.merge.eligibility_gate`
- Legacy truth: 当前 merge authority 函数在被调用时要求 exact-head CI、Evaluator、Judge、
  适用人审、approved contract 和 risk facts；该 owner 只做决定，不执行 GitHub merge。
- Repo evidence:
  - `packages/brain/src/orchestrator/gates.js`
  - `packages/brain/src/orchestrator/merge-authority.js`
  - `packages/brain/src/orchestrator/__tests__/gates.test.js`
  - `packages/brain/src/orchestrator/__tests__/merge-authority.test.js`
- Canonical steps: `[S5, S6, S7, S8, S9]`
- Canonical dimensions:
  `[fr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, adversarial_surface, ledger_freshness, axis_alignment]`
- Probe count: **12**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-04-01-001` .. `004`
  - violation: `KERNEL-PROBE-P0-04-01-005` .. `012`
  - recovery: bind the selected stale/missing violation, obtain fresh facts for the same current head, then
    rerun `KERNEL-PROBE-P0-04-01-001` .. `004`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-04-01-001` | Current-head Evaluator PASS is accepted as one required fact. |
| `KERNEL-PROBE-P0-04-01-002` | Current-head independent Judge PASS is accepted as one required fact. |
| `KERNEL-PROBE-P0-04-01-003` | Risk-required human approval bound to the current head and request is accepted. |
| `KERNEL-PROBE-P0-04-01-004` | Exact-head trusted CI checks plus a valid remote-policy observation make the CI fact eligible. |
| `KERNEL-PROBE-P0-04-01-005` | Draft, closed, merged, or non-clean PR is denied; retain each case. |
| `KERNEL-PROBE-P0-04-01-006` | Missing or stale Evaluator verdict is denied. |
| `KERNEL-PROBE-P0-04-01-007` | Missing, stale, self-authored, or failed Judge verdict is denied; retain each case. |
| `KERNEL-PROBE-P0-04-01-008` | CI failure, skipped, cancelled, pending, or unknown is denied; retain each case. |
| `KERNEL-PROBE-P0-04-01-009` | New commit, expired approval, or mismatched review request invalidates human approval. |
| `KERNEL-PROBE-P0-04-01-010` | Missing, unapproved, superseded, or digest-mismatched contract is denied. |
| `KERNEL-PROBE-P0-04-01-011` | Changed base SHA, diff digest, required-check digest, or path surface is denied. |
| `KERNEL-PROBE-P0-04-01-012` | Title, label, branch name, PR body, or caller assertion cannot create merge eligibility. |

### KERNEL-INV-P0-04-02-DURABLE-EXACT-SHA-AUTHORIZATION

- Name: Durable Exact-SHA Authorization
- Classification: `drifted_required_gap`
- Effect owner: Merge Authorization Store
- Seam: `kernel.merge.authorization`
- Legacy truth: 当前代码能持久化 SHA-bound proof 和 intent；旧平台曾有多个独立 merge
  通道，尚无 atom-bound live proof 证明生产 one-shot consumption 和 crash recovery。
- Repo evidence:
  - `packages/brain/src/orchestrator/merge-authority.js`
  - `packages/brain/src/orchestrator/merge-effect-store.js`
  - `packages/brain/src/orchestrator/__tests__/merge-authority.test.js`
  - `packages/brain/src/orchestrator/__tests__/merge-effect-store.test.js`
- Canonical steps: `[S9]`
- Canonical dimensions:
  `[invariant, checkpoint, freshness, failure_semantics, effect_confirmation, ledger_freshness, axis_alignment]`
- Probe count: **8**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-04-02-001`
  - violation: `KERNEL-PROBE-P0-04-02-002` .. `006`, `008`
  - recovery: bind the stale/conflict violation, issue a fresh authorization generation, then execute
    `KERNEL-PROBE-P0-04-02-007`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-04-02-001` | Exact run/task/repository/PR/base/head/diff/contract/risk authorization and durable intent are committed before any GitHub effect. |
| `KERNEL-PROBE-P0-04-02-002` | Run, task, repository, PR, or head-ref ownership conflict is denied. |
| `KERNEL-PROBE-P0-04-02-003` | Stale head, base, diff, contract, or required-check binding is denied. |
| `KERNEL-PROBE-P0-04-02-004` | Expired risk or human-review authority is denied. |
| `KERNEL-PROBE-P0-04-02-005` | Missing, denied, or mismatched merge intent cannot issue authorization. |
| `KERNEL-PROBE-P0-04-02-006` | Concurrent or duplicate issuance creates at most one effective authorization and one durable intent. |
| `KERNEL-PROBE-P0-04-02-007` | Consumed/replayed authorization returns the recorded effect state or requires a fresh generation; it never creates a second merge. |
| `KERNEL-PROBE-P0-04-02-008` | Transaction, lock, or persistence failure before commit prevents every GitHub mutation. |

### KERNEL-INV-P0-04-03-GITHUB-MERGE-EFFECT-AND-CONFIRMATION

- Name: GitHub Merge Effect and Confirmation
- Classification: `drifted_required_gap`
- Effect owner: Merge Effect Executor
- Seam: `kernel.merge.effect_executor`
- Legacy truth: 默认 orchestrator assembly 构造该 executor；它使用
  `--match-head-commit`、effect 前重读、effect 后观察及 crash reconciliation。没有
  atom-bound live receipt 时不得宣称生产等价 proven。
- Repo evidence:
  - `packages/brain/src/orchestrator/run.js`
  - `packages/brain/src/orchestrator/merge-effect-executor.js`
  - `packages/brain/src/orchestrator/github-merge-adapter.js`
  - `packages/brain/src/orchestrator/__tests__/merge-effect-executor.test.js`
  - `packages/brain/src/orchestrator/__tests__/github-merge-adapter.test.js`
- Canonical steps: `[S9]`
- Canonical dimensions:
  `[invariant, checkpoint, freshness, failure_semantics, effect_confirmation, adversarial_surface, ledger_freshness]`
- Probe count: **10**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-04-03-001`, `002`, `005`
  - violation: `KERNEL-PROBE-P0-04-03-003`, `004`, `006`, `009`, `010`
  - recovery: bind the violation/unknown-effect predecessor and execute
    `KERNEL-PROBE-P0-04-03-007` or `008` as applicable

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-04-03-001` | Squash merge uses the exact PR URL and `--match-head-commit <authorized SHA>`. |
| `KERNEL-PROBE-P0-04-03-002` | Required checks, branch policy, base, diff, contract, and review authority are re-observed immediately before effect. |
| `KERNEL-PROBE-P0-04-03-003` | Head/base/diff change between authorization and effect is denied before merge. |
| `KERNEL-PROBE-P0-04-03-004` | `--admin`, bypass, wrong method, or unbounded merge mode is denied. |
| `KERNEL-PROBE-P0-04-03-005` | Success requires post-effect observation of merged state, authorized head, and merge commit SHA. |
| `KERNEL-PROBE-P0-04-03-006` | Command success without remote merged observation remains BLOCKED. |
| `KERNEL-PROBE-P0-04-03-007` | Command error followed by remote merged truth is reconciled as confirmed-with-concerns without reissue. |
| `KERNEL-PROBE-P0-04-03-008` | Crash after merge is recovered by observation and receipted without a second merge command. |
| `KERNEL-PROBE-P0-04-03-009` | Command failure plus confirmed-unmerged truth creates only a bounded failed receipt. |
| `KERNEL-PROBE-P0-04-03-010` | Invalid PR URL, repository identity, expected SHA, or merge method is denied. |

### KERNEL-INV-P0-04-04-EXCLUSIVE-MERGE-CAPABILITY-FIREWALL

- Name: Exclusive Merge Capability Firewall
- Classification: `drifted_required_gap`
- Effect owner: Merge Capability Authority
- Seam: `kernel.merge.capability_firewall`
- Legacy truth: CI auto-merge job、Stop/post-create hooks 和 evaluator callback 的直接 merge
  已部分撤销，Bash guard 拒绝裸 `gh pr merge`；静态字符串检查不能证明所有 API、workflow
  token、manual/scheduled path 都已失权。
- Repo evidence:
  - `packages/brain/src/__tests__/legacy-harness-merge-firewall.test.js`
  - `packages/engine/hooks/bash-guard.sh`
  - `.github/workflows/ci.yml`
  - `.github/workflows/scripts/should-auto-merge.sh`
  - `.github/workflows/auto-version.yml`
  - `packages/quality/hooks/stop.sh`
  - `packages/quality/hooks/post-pr-create.sh`
- Canonical steps: `[S5, S6, S7, S8, S9]`
- Canonical dimensions:
  `[nfr, invariant, checkpoint, freshness, failure_semantics, effect_confirmation, adversarial_surface, axis_alignment]`
- Probe count: **10**
- Scenario mapping:
  - normal: `KERNEL-PROBE-P0-04-04-008`, `KERNEL-PROBE-P0-04-04-010`
  - violation: `KERNEL-PROBE-P0-04-04-001` .. `007`, `009`
  - recovery: bind the unauthorized-path violation, revoke the leaked capability or remove the alternate
    path, then rerun `KERNEL-PROBE-P0-04-04-008` and `010`

| Probe ID | Mandatory definition |
|---|---|
| `KERNEL-PROBE-P0-04-04-001` | Agent or ordinary Bash session direct `gh pr merge` is denied. |
| `KERNEL-PROBE-P0-04-04-002` | Evaluator, Judge, or callback PASS cannot directly merge. |
| `KERNEL-PROBE-P0-04-04-003` | CI workflow remains read-only and cannot merge after CI success. |
| `KERNEL-PROBE-P0-04-04-004` | Stop and post-PR hooks cannot merge or enable auto-merge. |
| `KERNEL-PROBE-P0-04-04-005` | Auto-version, scheduled, manual, orphan, and shepherd paths cannot independently merge; retain each case. |
| `KERNEL-PROBE-P0-04-04-006` | Title, label, branch regex, PR body, environment variable, or provider output cannot grant merge authority. |
| `KERNEL-PROBE-P0-04-04-007` | GraphQL, REST API, auto-merge, alternate CLI, and shell-syntax variants cannot bypass the firewall; retain each case. |
| `KERNEL-PROBE-P0-04-04-008` | Credential and workflow-permission inventory proves only the merge effect executor can consume merge capability. |
| `KERNEL-PROBE-P0-04-04-009` | A leaked, stale, wrong-service, or over-scoped merge token is rejected and revoked. |
| `KERNEL-PROBE-P0-04-04-010` | GitHub audit observation binds the merger actor/service, repository, PR, head SHA, and resulting merge SHA to the authorized executor receipt. |

## 6. Non-duplication boundary

- `KERNEL-INV-P0-03-04-REMOTE-PROTECTED-REF-POLICY` owns GitHub ruleset truth.
  `KERNEL-INV-P0-04-01-MERGE-ELIGIBILITY-DECISION` may consume its observation but cannot prove or
  configure the ruleset.
- `KERNEL-INV-P0-04-01-MERGE-ELIGIBILITY-DECISION` owns the allow/deny decision.
  `KERNEL-INV-P0-04-02-DURABLE-EXACT-SHA-AUTHORIZATION` owns the durable authorization record.
  `KERNEL-INV-P0-04-03-GITHUB-MERGE-EFFECT-AND-CONFIRMATION` alone owns the external merge effect.
- `KERNEL-INV-P0-04-04-EXCLUSIVE-MERGE-CAPABILITY-FIREWALL` proves absence of alternate effect
  owners; static grep is partial evidence only.
- Local hook/precheck success is never a substitute for remote GitHub policy, exact-SHA authorization,
  live effect observation, or atom-bound signed receipts.
