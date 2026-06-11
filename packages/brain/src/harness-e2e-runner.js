/**
 * harness-e2e-runner.js — 代码执行段封装（evaluateContractNode Step 2）。
 *
 * 负责逐行执行合同 E2E 脚本命令，采集 exitCode/stdout/stderr/elapsedMs，
 * 返回 ExecutionRecordSchema 兼容对象，并可落盘 execution-record.json。
 * 不做语义裁读 — verdict/coverage 由 LLM 裁读段（evaluateContractNode Step 3）负责。
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const execFileDefault = promisify(execFileCb);

const DEFAULT_CMD_TIMEOUT_MS = 60_000;
const DEFAULT_OUTPUT_CAP = 10_000;

/**
 * 逐行执行合同 E2E 脚本命令，采集逐命令结果。
 * 遇单条命令失败不中止，完整记录所有命令输出供 LLM 裁读段分析。
 *
 * @param {string} scriptText  合同 E2E 脚本原文（多行 bash）
 * @param {object} [opts]
 * @param {string}   [opts.cwd]         执行目录
 * @param {number}   [opts.timeoutMs]   单命令超时 ms（默认 60000）
 * @param {number}   [opts.outputCap]   stdout/stderr 截断字节（默认 10000）
 * @param {Function} [opts.execFile]    注入 execFile（测试用 DI）
 * @returns {Promise<{commands: Array<{cmd,exitCode,stdout,stderr,elapsedMs}>}>}
 */
export async function runE2eScriptCommands(scriptText, opts = {}) {
  const execFn   = opts.execFile  || execFileDefault;
  const timeoutMs = opts.timeoutMs || DEFAULT_CMD_TIMEOUT_MS;
  const outputCap = opts.outputCap || DEFAULT_OUTPUT_CAP;
  const cwd = opts.cwd;

  const lines = typeof scriptText === 'string' ? scriptText.split('\n') : [];
  const commands = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // 跳过注释行与空行
    if (!line || line.startsWith('#')) continue;

    const start = Date.now();
    let exitCode = 0;
    let stdout   = '';
    let stderr   = '';

    try {
      const res = await execFn('bash', ['-c', line], {
        cwd,
        timeout:   timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });
      stdout = (res.stdout  || '').toString().slice(-outputCap);
      stderr = (res.stderr  || '').toString().slice(-outputCap);
      exitCode = 0;
    } catch (err) {
      stdout   = (err.stdout  || '').toString().slice(-outputCap);
      stderr   = (err.stderr  || err.message || '').toString().slice(-outputCap);
      exitCode = typeof err.code === 'number' ? err.code : 1;
      if (err.killed || err.signal === 'SIGTERM') {
        exitCode = -1;
        stderr   = `TIMEOUT after ${timeoutMs}ms: ${stderr}`.slice(-outputCap);
      }
    }

    commands.push({ cmd: line, exitCode, stdout, stderr, elapsedMs: Date.now() - start });
  }

  return { commands };
}

/**
 * 执行 E2E 脚本命令并将结果落盘 execution-record.json（execution-record 产物）。
 * 落盘失败非致命，仍返回执行记录供调用方使用。
 *
 * @param {string} scriptText
 * @param {string} outputPath  写入路径（如 <worktreePath>/<sprintDir>/execution-record.json）
 * @param {object} [opts]      同 runE2eScriptCommands opts
 * @returns {Promise<{commands: Array}>}
 */
export async function runAndRecordE2eCommands(scriptText, outputPath, opts = {}) {
  const record = await runE2eScriptCommands(scriptText, opts);
  if (outputPath) {
    try {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(record, null, 2), 'utf8');
    } catch (writeErr) {
      console.warn(`[e2e-runner] 写 execution-record.json 失败（非致命）: ${writeErr.message}`);
    }
  }
  return record;
}
