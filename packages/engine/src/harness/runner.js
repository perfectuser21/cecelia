/**
 * Harness 可选的脚本化执行记录器（工具库）。
 *
 * executeAndRecord 封装 runScenarioCommand，落盘结构化执行记录。
 *
 * 重要：这是【可选的脚本化执行记录器，不替代 evaluator agent 的人类式执行权】。
 * 用户拍板的验收架构是「运动员-摄像头-裁判」三权分立：evaluator agent 像人类 QA 一样在真实
 * 环境亲手执行验证（运动员，执行权不被代码取代），证据自动留痕（摄像头），DeepSeek 独立裁判
 * 判读（packages/brain/src/harness-judge.js）。本模块仅作为可选工具：当某条 contract E2E 适合
 * 纯命令脚本化执行 + 记录时可被调用产生结构化记录——但它不是 pipeline 的默认执行路径。
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
