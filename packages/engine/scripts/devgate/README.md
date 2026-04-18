# Engine ↔ Superpowers Alignment DevGate Scripts (T4 Draft)

Three DevGate scripts drafted for the Engine ↔ Superpowers alignment
Initiative. All three are standalone, read-only, and safe to run locally
or in GitHub Actions (`ubuntu-latest`).

Target install location (NOT yet deployed):

```
packages/engine/scripts/check-superpowers-alignment.cjs
packages/engine/scripts/check-engine-hygiene.cjs
packages/engine/scripts/bump-version.sh
```

---

## 1. check-superpowers-alignment.cjs

Verifies that every skill declared in
`packages/engine/contracts/superpowers-alignment.yaml` is actually wired
into the Engine and has a matching local prompt.

### Invocation

```bash
node packages/engine/scripts/check-superpowers-alignment.cjs
node packages/engine/scripts/check-superpowers-alignment.cjs --verbose
REPO_ROOT=/path/to/cecelia node packages/engine/scripts/check-superpowers-alignment.cjs
```

### Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | All `full` / `partial` skills verified, all `rejected` skills have `rejection_reason` |
| 1    | Contract violation (missing anchor, missing keyword, sha256 mismatch, missing rejection reason, malformed YAML) |
| 2    | Unexpected fatal error (stack trace printed)                  |

### What it checks

For each skill in `contract.skills[]`:

- **coverage_level: full / partial**
  - `engine_integration.anchor_file` file exists on disk.
  - Every string in `engine_integration.required_keywords` appears
    somewhere in that anchor file (substring match, at least once).
  - If `local_prompt.path` is present:
    - the file exists;
    - `sha256(file)` equals `local_prompt.sha256` (a value starting with
      `PENDING_` is tolerated with a warning, not a failure).
- **coverage_level: rejected**
  - `rejection_reason` is present and non-empty.
- **Other coverage_level values** → `[SKIP]` (not counted either way).

### Dependencies

- Node 18+.
- `js-yaml` is used if available (it lives in `packages/engine/node_modules`
  indirectly via many deps). If `require('js-yaml')` fails, a **built-in
  minimal YAML parser** kicks in — it handles the block-style subset
  actually used by `superpowers-alignment.yaml` (mappings, sequences of
  mappings, scalar sequences, quoted/unquoted scalars, comments).
  No runtime install is required.

### Sample output

```
[check-superpowers-alignment] Reading packages/engine/contracts/superpowers-alignment.yaml...
[check-superpowers-alignment] 14 skills declared

[OK]   brainstorming (full)
       anchor: packages/engine/skills/dev/steps/01-spec.md
       keywords: 5/5 found
       local_prompt: packages/engine/skills/dev/prompts/brainstorming/SKILL.md (sha256 OK)

[FAIL] test-driven-development (full)
       anchor: packages/engine/skills/dev/steps/02-code.md
       keywords: 2/3 found
       - FAIL: 2/3 keywords found (MISSING: "condition-based-waiting")

...

[FAIL] 1 violation(s) across 1 skill(s)
  - test-driven-development: 2/3 keywords found (MISSING: "condition-based-waiting")
```

---

## 2. check-engine-hygiene.cjs

Quick sweep of `packages/engine/` for garbage and version drift.

### Invocation

```bash
node packages/engine/scripts/check-engine-hygiene.cjs
node packages/engine/scripts/check-engine-hygiene.cjs --verbose
```

### Exit codes

| Code | Meaning                                  |
| ---- | ---------------------------------------- |
| 0    | All four checks passed                   |
| 1    | At least one hygiene violation           |
| 2    | Unexpected fatal error (stack trace)     |

### Checks

| # | Name | Scope | Rule |
|---|------|-------|------|
| 1 | `no-manual-todo` | `packages/engine/**/*.{md,sh,cjs}` | The literal string `manual:TODO` is forbidden anywhere. |
| 2 | `no-external-superpowers-ref` | `packages/engine/**/*.md` | The pattern `superpowers:<pkg>/<file>.md` is forbidden — prompts must live under `packages/engine/skills/dev/prompts/`. Bare mentions like `superpowers:brainstorming` (no `/file.md`) are OK. |
| 3 | `regression-contract-nonempty` | `packages/engine/regression-contract.yaml` | Top-level keys `core:` and `golden_paths:` must not be empty lists (`[]`) and must not be empty blocks. `allow_empty: true` on the same or next line bypasses the check. |
| 4 | `version-sync` | 5 files (see below) | All 5 files must report the same version string. |

Version sync targets:

1. `packages/engine/VERSION` (entire file).
2. `packages/engine/package.json` → top-level `"version"`.
3. `packages/engine/.hook-core-version` (entire file).
4. `packages/engine/skills/dev/SKILL.md` → frontmatter `version:` within
   the first `---` block.
5. `packages/engine/regression-contract.yaml` → first top-level
   `version:` line.

> **Known shape mismatch**: `skills/dev/SKILL.md` currently carries its
> own `version: 7.2.0` frontmatter which is the *skill*-level version,
> not the Engine package version. The task spec explicitly lists
> `SKILL.md` as one of the 5 targets, so this script enforces sync.
> If the team decides SKILL.md should track its own semver instead,
> drop it from the `targets` array in `checkVersionSync()`.

### Dependencies

- Node 18+. No external npm packages.

### Sample output

```
[check-engine-hygiene] scanning packages/engine/ ...

[check-engine-hygiene] version sync report:
  [OK  ] VERSION                    14.17.4
  [OK  ] package.json               14.17.4
  [OK  ] .hook-core-version         14.17.4
  [FAIL] skills/dev/SKILL.md        7.2.0
  [OK  ] regression-contract.yaml   14.17.4

[FAIL] 1 hygiene violation(s):
  [version-sync] packages/engine/skills/dev/SKILL.md  skills/dev/SKILL.md: has "7.2.0" (expected "14.17.4")
```

---

## 3. bump-version.sh

Sync the Engine version across 5 source-of-truth files (+
`package-lock.json` if present) with a single command. Cross-platform
(macOS + Linux); does all file mutations through inline `node -e` so
there are no `sed -i` portability issues.

### Invocation

```bash
bash packages/engine/scripts/bump-version.sh 14.17.5       # explicit version
bash packages/engine/scripts/bump-version.sh patch         # 14.17.4 -> 14.17.5
bash packages/engine/scripts/bump-version.sh minor         # 14.17.4 -> 14.18.0
bash packages/engine/scripts/bump-version.sh major         # 14.17.4 -> 15.0.0
bash packages/engine/scripts/bump-version.sh 14.17.5 --dry-run
REPO_ROOT=/path/to/cecelia bash packages/engine/scripts/bump-version.sh patch
```

### Exit codes

| Code | Meaning                                                                |
| ---- | ---------------------------------------------------------------------- |
| 0    | Version bump succeeded (or dry-run printed plan, or new == current)    |
| 1    | Any error (bad argument, missing VERSION file, mutation failure, etc.) |

On any mutation failure, all target files are restored from an
in-memory backup taken at the start of the run.

### Target files

| File | Type of update |
| ---- | --------------- |
| `packages/engine/VERSION` | Entire file replaced (keeps trailing newline if present). |
| `packages/engine/package.json` | Regex replace of top-level `"version": "..."` only. |
| `packages/engine/package-lock.json` | JSON parse, update `.version` and `.packages[""].version`, write back with 2-space indent. |
| `packages/engine/.hook-core-version` | Entire file replaced. |
| `packages/engine/skills/dev/SKILL.md` | Frontmatter `version:` line only (within first `---` block). |
| `packages/engine/regression-contract.yaml` | First top-level `version:` line only. |

### Dependencies

- Bash 4+ (works with macOS's default 3.2 but is exercised on bash 5.x).
- Node 18+ for the inline mutations.
- No external packages.

### Local smoke test

```bash
cd /path/to/cecelia
bash packages/engine/scripts/bump-version.sh 14.17.4 --dry-run   # no change
bash packages/engine/scripts/bump-version.sh patch --dry-run     # preview +0.0.1
node packages/engine/scripts/check-engine-hygiene.cjs            # confirm sync
```

---

## Local debug cheatsheet

```bash
# From repo root:
export REPO_ROOT="$PWD"

# Run all three DevGates:
node packages/engine/scripts/check-superpowers-alignment.cjs --verbose
node packages/engine/scripts/check-engine-hygiene.cjs --verbose

# Bump cycle:
bash packages/engine/scripts/bump-version.sh patch
node packages/engine/scripts/check-engine-hygiene.cjs   # should pass
git diff packages/engine                                # review changes
```

## CI integration sketch

Add to `.github/workflows/engine-ci.yml` L1 job (no npm install needed):

```yaml
- name: Engine DevGate
  run: |
    node packages/engine/scripts/check-engine-hygiene.cjs
    node packages/engine/scripts/check-superpowers-alignment.cjs
```

Both scripts run in under a second on a typical repo checkout.
