#!/usr/bin/env node
// ratchet-guard.mjs — 棘轮统一台账守卫（刀4-T2）
// 读 ratchet-registry.json，逐项断言当前值不越水位，退出非零并打印违规指标名
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import {
  classifySprintArtifacts,
  countPermanent,
} from './test-pyramid-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

// ── 辅助 ────────────────────────────────────────────────────────────────────

function brainGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function walkSh(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) walkSh(path.join(dir, e.name), out);
    else if (e.isFile() && e.name.endsWith('.sh')) out.push(path.join(dir, e.name));
  }
  return out;
}

// ── 指标测量 ─────────────────────────────────────────────────────────────────

async function measure(metric, baseline, brainBase, root) {
  switch (metric.name) {
    case 'orphans': {
      const classification = classifySprintArtifacts(root);
      return {
        value: classification.unregistered.total,
        detail: `raw=${classification.raw.total} registered=${classification.registered.total} unregistered=${classification.unregistered.total}`,
      };
    }
    case 'permanent_tests': {
      const roots = baseline?.permanent_roots ?? [];
      const r = countPermanent(root, roots);
      return { value: r.total, detail: `layers=${JSON.stringify(r.layers)}` };
    }
    case 'bare_fr': {
      const d = await brainGet(`${brainBase}/api/brain/journey_features/unguarded-count`);
      if (d === null || d.count === undefined) return { value: null, skipped: true };
      return { value: d.count, detail: 'live FRs without guard_ref' };
    }
    case 'seven_ring_hard_flaws': {
      const d = await brainGet(`${brainBase}/api/brain/kv/seven_ring_audit_last`);
      if (d === null || !d.value_json) return { value: null, skipped: true };
      const hard_flaws = d.value_json?.hard_flaws ?? null;
      if (hard_flaws === null) return { value: null, skipped: true };
      return { value: hard_flaws, detail: `audited_at=${d.value_json.audited_at ?? '?'}` };
    }
    case 'smoke_pool': {
      const files = walkSh(path.join(root, 'scripts', 'smoke'));
      return { value: files.length, detail: `scripts/smoke/ .sh 脚本数` };
    }
    default:
      return { value: null, skipped: true, reason: `未知指标 ${metric.name}` };
  }
}

// ── 主逻辑 ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const brainBase = args.find(a => a.startsWith('--brain='))?.slice(8) ?? 'http://localhost:5221';
  const rootArg = args.find(a => a.startsWith('--root='))?.slice(7)
    ?? (args.includes('--root') ? args[args.indexOf('--root') + 1] : null);
  const root = rootArg ? path.resolve(rootArg) : DEFAULT_ROOT;
  const registryArg = args.find(a => a.startsWith('--registry='))?.slice(11)
    ?? (args.includes('--registry') ? args[args.indexOf('--registry') + 1] : null);
  const registryPath = registryArg
    ? path.resolve(registryArg)
    : path.join(root, 'scripts', 'ratchet-registry.json');
  const baselinePath = path.join(root, 'scripts', 'test-pyramid-baseline.json');

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (e) {
    console.error(`❌ 读取 ratchet-registry.json 失败: ${e.message}`);
    process.exit(1);
  }

  let baseline = null;
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); } catch { /* ok */ }

  const results = [];
  const failures = [];

  for (const metric of registry) {
    const r = await measure(metric, baseline, brainBase, root);

    if (r.skipped) {
      results.push({ name: metric.name, label: metric.label, direction: metric.direction, watermark: metric.watermark, value: null, status: 'skipped', reason: r.reason ?? 'Brain 不可达' });
      if (!jsonMode) console.log(`  ⏭ ${metric.name}: skipped（${r.reason ?? 'Brain 不可达'}）`);
      continue;
    }

    const { value } = r;
    let violated = false;
    if (metric.direction === 'only_down' && value > metric.watermark) violated = true;
    if (metric.direction === 'only_up'   && value < metric.watermark) violated = true;

    const status = violated ? 'fail' : 'pass';
    results.push({ name: metric.name, label: metric.label, direction: metric.direction, watermark: metric.watermark, value, status, detail: r.detail });

    if (!jsonMode) {
      const icon = violated ? '❌' : '✅';
      console.log(`  ${icon} ${metric.name}: ${value} (${metric.direction === 'only_down' ? '↓≤' : '↑≥'}${metric.watermark}) ${r.detail ?? ''}`);
    }

    if (violated) {
      failures.push(`${metric.name}（${metric.label}）: 当前值 ${value} 越过水位 ${metric.watermark}，方向 ${metric.direction}`);
    }
  }

  const pass = failures.length === 0;

  if (jsonMode) {
    console.log(JSON.stringify({ pass, failures, results }, null, 2));
  } else {
    if (failures.length) {
      console.log('\n棘轮台账守卫 FAIL：');
      for (const f of failures) console.log(`  ❌ ${f}`);
    } else {
      console.log('\n✅ 棘轮台账守卫 PASS（所有指标未越水位）');
    }
  }

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
