# B34 Sprint Subdirectory Detection Design

## Background

Harness planner (following SKILL.md convention seen in live worktrees) creates sprint artifacts under `sprints/{sprint-name}/` (e.g., `sprints/w44-walking-skeleton-b33/`). Brain code in three places reads from `sprints/` flat, causing ENOENT failures:

1. `harness-initiative.graph.js` runner Phase A → `sprints/sprint-prd.md` not found
2. `harness-initiative.graph.js` LangGraph `parsePrdNode` → same path
3. `harness-gan.graph.js` `defaultReadContractFile` → `sprints/contract-draft.md` not found

W44 validation run failed at `inferTaskPlanNode` with "proposer_didnt_push: branch missing `sprints/task-plan.json`" — the file was actually at `sprints/w44-walking-skeleton-b33/task-plan.json`.

## Design

### Change 1 — Runner Phase A (harness-initiative.graph.js ~line 169)

After the existing `try/catch` fails to read `sprints/sprint-prd.md`, add a subdirectory scan:

```js
// Fallback: scan sprints/*/sprint-prd.md
let effectiveSprintDir = sprintDir;
const sprintsRoot = pathMod.join(worktreePath, 'sprints');
try {
  const entries = await fsPromises.readdir(sprintsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = pathMod.join(sprintsRoot, entry.name, 'sprint-prd.md');
    try {
      prdContent = await fsPromises.readFile(candidate, 'utf8');
      effectiveSprintDir = pathMod.join('sprints', entry.name);
      break;
    } catch { /* keep scanning */ }
  }
} catch { /* sprints/ doesn't exist */ }
```

`effectiveSprintDir` is then passed to `runGanContractGraph(…, effectiveSprintDir)` replacing the original `sprintDir`.

### Change 2 — LangGraph parsePrdNode (harness-initiative.graph.js ~line 631)

Same subdir scan pattern. The node returns `{ prdContent, sprintDir: effectiveSprintDir }` so downstream LangGraph nodes receive the corrected path.

**State integration**: `runGanLoopNode` reads `state.task?.payload?.sprint_dir` (line 649). `parsePrdNode`'s returned `sprintDir` sets the LangGraph state key `sprintDir`. The `runGanLoopNode` must be updated to also check `state.sprintDir` before falling back to `state.task?.payload?.sprint_dir`.

### Change 3 — defaultReadContractFile (harness-gan.graph.js ~line 243)

After the existing static candidates fail, add a readdir scan of `sprintDir` subdirectories as defense-in-depth:

```js
// Defense-in-depth: scan sprintDir subdirectories
try {
  const entries = await fs.readdir(path.join(worktreePath, sprintDir), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const name of ['contract-draft.md', 'sprint-contract.md']) {
      candidates.push(path.join(worktreePath, sprintDir, entry.name, name));
    }
  }
} catch { /* ignore */ }
```

## Architecture

Three surgical additions, no new abstractions. The helper pattern (try flat path → scan subdirs) is repeated consistently across all three locations.

## Testing Strategy

- **Unit test** (`tests/workflows/sprint-subdir-detection.test.js`): mock `fsPromises.readdir` / `readFile`, verify that when flat path fails, subdirectory is found and `effectiveSprintDir` is updated.
- **Integration test** (manual smoke): dispatch W45 thin_prd after B34 merged; planner produces `sprints/w45-*/sprint-prd.md`; runner Phase A, parsePrdNode, and GAN must all resolve without ENOENT.

The unit test covers Change 1 & 2 (runner + parsePrdNode) and Change 3 (defaultReadContractFile). The integration smoke (W45) covers end-to-end behavior.
