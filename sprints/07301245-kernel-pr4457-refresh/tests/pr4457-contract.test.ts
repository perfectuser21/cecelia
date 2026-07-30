import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const sprintDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(sprintDir, '../..');
const verifier = path.join(sprintDir, 'scripts', 'verify-pr4457-evidence.mjs');
const oracleManifest = path.join(sprintDir, 'conflict-oracle-manifest.json');
const ORACLE_MANIFEST_SHA256 = '97166a9ecfec61572691cfee4b1dfa6a567657ca92663e00f7923b7fe9920460';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) =>
      [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

async function run(phase: string) {
  return await Promise.resolve(spawnSync(process.execPath, [verifier, phase], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, EXPECTED_PR: '4457' },
  }));
}

describe('PR #4457 contract [BEHAVIOR]', () => {
  it('33 路径 oracle manifest 的 schema 身份 argv 与语义哈希精确匹配', async () => {
    // 静态 manifest 本身已在合同阶段冻结；它必须同时跨过由实现产出的
    // conflicts verifier/evidence 边界，避免实现尚不存在时仅靠静态 JSON 假绿。
    const boundary = await run('conflicts');
    expect(boundary.status, boundary.stderr || boundary.stdout).toBe(0);
    const manifest = JSON.parse(await fs.promises.readFile(oracleManifest, 'utf8'));
    manifest.subjects.sort((a: { path: string }, b: { path: string }) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const digest = crypto.createHash('sha256')
      .update(JSON.stringify(canonical(manifest))).digest('hex');
    expect(manifest.schema_version).toBe(1);
    expect(manifest.subjects).toHaveLength(33);
    expect(new Set(manifest.subjects.map((row: { path: string }) => row.path)).size).toBe(33);
    expect(new Set(manifest.subjects.map((row: { oracle_id: string }) => row.oracle_id)).size).toBe(33);
    expect(manifest.subjects.every((row: { cwd: string; argv: string[]; expected_observation: string }) =>
      row.cwd.length > 0 && row.argv.length > 0 && row.expected_observation.includes('exit_code=0'))).toBe(true);
    expect(digest).toBe(ORACLE_MANIFEST_SHA256);
  });

  it('冻结身份与全部 subject 精确匹配', async () => {
    const result = await run('freeze');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('全部 33 个冲突路径完成行为验证', async () => {
    const result = await run('conflicts');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('全部 77 条 CodeQL annotation 收敛', async () => {
    const result = await run('codeql');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('累计 Kernel Harness 行为与 atomic truth 保持', async () => {
    const result = await run('regressions');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('三个 required checks 绑定同一最终 SHA', async () => {
    const result = await run('exact-head');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('evaluator 在同一最终 SHA 真跑', async () => {
    const result = await run('evaluator');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('审计窗内无新 PR 无 merge 无 deploy', async () => {
    const result = await run('review-gate');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
