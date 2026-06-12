/**
 * Harness 执行记录模块。
 * executeAndRecord 封装 runScenarioCommand，落盘结构化执行记录。
 */

import { runScenarioCommand } from '../../../brain/src/harness-final-e2e.js';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';

const OUTPUT_CAP = 8000;

/**
 * 以代码方式执行命令，落盘结构化执行记录。
 *
 * @param {{cmd: string, type?: string}} cmd
 * @param {{sprintDir?: string, cwd?: string, timeoutMs?: number}} opts
 * @returns {Promise<{run_id, script_path, started_at, exit_code, stdout, stderr, duration_ms}>}
 */
export async function executeAndRecord(cmd, opts = {}) {
  const sprintDir = opts.sprintDir || process.env.SPRINT_DIR;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const { exitCode, output } = runScenarioCommand(cmd, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
  });

  const durationMs = Math.max(0, Date.now() - start);
  const stdout = output.length > OUTPUT_CAP ? output.slice(-OUTPUT_CAP) : output;

  const record = {
    run_id: runId,
    script_path: cmd.cmd,
    started_at: startedAt,
    exit_code: exitCode,
    stdout,
    stderr: '',
    duration_ms: durationMs,
  };

  if (sprintDir) {
    const recordsDir = path.join(sprintDir, 'exec-records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(
      path.join(recordsDir, `${runId}.json`),
      JSON.stringify(record, null, 2),
    );
  }

  return record;
}
