#!/usr/bin/env node
// crystal-verify.mjs — 结晶验证器:热路径连跑 N 次(默认3),产出判官可消费的证据 JSON。
// 判据(Alex 修正版,决策 ca9f3d7b):不追"无 LLM"教条——序列导航零 token,
// postcondition/回源保留 LLM。通过 = N 次全 ok 且全程零视觉回源(纯 registry 热路径)。
// 用法: node crystal-verify.mjs --sequence sequences/search_account.json --target <账号> [--runs 3]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const runs = Number(args.runs ?? 3);
const here = path.dirname(new URL(import.meta.url).pathname);

const results = [];
for (let i = 1; i <= runs; i += 1) {
  let out; let ok = false;
  try {
    out = execFileSync('node', [path.join(here, 'replay.mjs'), '--sequence', args.sequence, '--target', args.target ?? ''],
      { encoding: 'utf8', timeout: 180_000 });
    ok = true;
  } catch (e) { out = e.stdout || e.message; }
  let parsed = null;
  try { parsed = JSON.parse(out.trim().split('\n').pop()); } catch { parsed = { ok: false, why: String(out).slice(0, 100) }; }
  results.push({ run: i, ...parsed });
  process.stderr.write(`run ${i}/${runs}: ok=${parsed.ok} ms=${parsed.ms} tokens=${parsed.tokens} 回源=${parsed.vision_locates}\n`);
}

const allOk = results.every((r) => r.ok);
const hotPath = results.every((r) => (r.vision_locates ?? 1) === 0);
const verdict = {
  sequence: path.basename(args.sequence, '.json'),
  runs,
  passes: results.filter((r) => r.ok).length,
  all_ok: allOk,
  pure_hot_path: hotPath,
  crystallized: allOk && hotPath,
  avg_ms: Math.round(results.reduce((s, r) => s + (r.ms ?? 0), 0) / runs),
  avg_tokens: Math.round(results.reduce((s, r) => s + (r.tokens ?? 0), 0) / runs),
  device: results[0]?.device,
  results,
  verified_at: new Date().toISOString(),
};
const outFile = path.join(here, `verify-${verdict.sequence}-${Date.now()}.json`);
fs.writeFileSync(outFile, JSON.stringify(verdict, null, 2));
console.log(JSON.stringify({ ...verdict, results: undefined, evidence_file: outFile }));
process.exit(verdict.crystallized ? 0 : 1);
