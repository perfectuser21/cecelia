import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Provider boundary fixture; the Runner bridge and all downstream consumers stay real.
const FIXTURE_WRITER = `node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const execution = JSON.parse(readFileSync(process.env.E2E_EXECUTION_FILE, 'utf8'));
writeFileSync(process.env.BRAIN_RESULT_FILE, JSON.stringify({
  task_id: process.env.CECELIA_TASK_ID,
  attempt_id: process.env.HARNESS_ATTEMPT_ID,
  verdict: 'PASS',
  behavior_tests: [{
    command: execution.command,
    exit_code: execution.exit_code,
    log_tail: readFileSync(process.env.E2E_RESULT_LOG, 'utf8').trimEnd(),
  }],
}));
NODE`;

export function runEvaluatorWriterAndBridge(result, { taskId, attemptId, command, logTail, writer = FIXTURE_WRITER }) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'kernel-evidence-bridge-'));
  const entrypoint = fileURLToPath(new URL(
    '../../../../../docker/cecelia-runner/entrypoint.sh',
    import.meta.url,
  ));
  const inheritedEnv = { ...process.env };
  delete inheritedEnv.HARNESS_REQUIRED_ASSERTIONS_JSON;
  try {
    writeFileSync(path.join(tempDir, 'writer.sh'), writer);
    writeFileSync(path.join(tempDir, 'normalized-result.json'), JSON.stringify(result));
    writeFileSync(path.join(tempDir, 'e2e-result.log'), `${logTail}\n`);
    writeFileSync(path.join(tempDir, 'evaluator-execution.json'), JSON.stringify({
      task_id: taskId,
      attempt_id: attemptId,
      command,
      exit_code: 0,
    }));
    execFileSync('bash', ['-c', `
      set -euo pipefail
      BRIDGE="$(sed -n '/evaluator-evidence-bridge:start/,/evaluator-evidence-bridge:end/p' "$1")"
      RESULT_WRITER="$(cat "$2/writer.sh")"
      eval "$BRIDGE"
      prepare_evaluator_evidence
      eval "$RESULT_WRITER"
      merge_evaluator_evidence "$2/normalized-result.json"
    `, 'bridge-test', entrypoint, tempDir], {
      env: {
        ...inheritedEnv,
        HARNESS_NODE: 'evaluator',
        HARNESS_ATTEMPT_ID: attemptId,
        CECELIA_TASK_ID: taskId,
        WORKTREE_PATH: tempDir,
        WORKSPACE: tempDir,
        TASK_ID: taskId,
        TARGET_ENV: 'local_api',
        E2E_EXECUTION_FILE: path.join(tempDir, 'evaluator-execution.json'),
        E2E_RESULT_LOG: path.join(tempDir, 'e2e-result.log'),
        SCREENSHOTS_JSON: '[]',
        CASCADE_ASSERTIONS: '[]',
        BRAIN_RESULT_FILE: path.join(tempDir, 'brain-result.json'),
      },
    });
    return JSON.parse(readFileSync(path.join(tempDir, 'normalized-result.json'), 'utf8'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

