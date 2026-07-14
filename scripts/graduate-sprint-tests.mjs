#!/usr/bin/env node
// graduate-sprint-tests.mjs — 刀1 sprint 测试毕业搬运脚本
// （计划: docs/superpowers/plans/2026-07-14-test-graduation.md Task 1）
// 把 sprint 的 tests/** 搬到 tests/regression/<slug>/（保留子目录结构），
// e2e-verify.sh 搬到 scripts/smoke/e2e/<slug>.sh。目标已存在同名文件抛错不覆盖。
// 用法：node scripts/graduate-sprint-tests.mjs --sprint <dir> [--dry-run] [--update-refs]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// sprint 目录名 → slug：去掉前导日期数字前缀，非 [a-zA-Z0-9-_] 转 '-'
// 例：07130752-relay-a85e0582 → relay-a85e0582
export function sprintSlug(name) {
  return name.replace(/^\d+-/, '').replace(/[^a-zA-Z0-9\-_]/g, '-');
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// 纯函数：产出搬运计划 { tests: [{from,to}], e2e: [{from,to}] }，路径均相对 root
export function planGraduation(root, sprintDir) {
  const abs = path.isAbsolute(sprintDir) ? sprintDir : path.join(root, sprintDir);
  const slug = sprintSlug(path.basename(abs));
  const plan = { tests: [], e2e: [] };

  const testsDir = path.join(abs, 'tests');
  for (const f of walk(testsDir).sort()) {
    plan.tests.push({
      from: path.relative(root, f),
      to: path.join('tests', 'regression', slug, path.relative(testsDir, f)),
    });
  }

  const e2e = path.join(abs, 'e2e-verify.sh');
  if (fs.existsSync(e2e)) {
    plan.e2e.push({
      from: path.relative(root, e2e),
      to: path.join('scripts', 'smoke', 'e2e', `${slug}.sh`),
    });
  }
  return plan;
}

// 执行搬运（dryRun=true 只出计划不落盘）。任一目标已存在 → 抛错，一个文件都不动。
// updateRefs=true：搬完后把根 DoD.md 里指向旧路径的引用重写为新路径
//（根 DoD.md 是当前 sprint 卡，其 manual 断言常指向 sprints/<dir>/e2e-verify.sh——
// 不重写则毕业 commit 会让 dod-behavior-dynamic 红、merge 被自己拦死，#3870 实证）。
export function graduate(root, sprintDir, { dryRun = false, updateRefs = false } = {}) {
  const plan = planGraduation(root, sprintDir);
  const moves = [...plan.tests, ...plan.e2e];
  if (!dryRun) {
    for (const m of moves) {
      if (fs.existsSync(path.join(root, m.to))) {
        throw new Error(`目标已存在，拒绝覆盖: ${m.to}（先人工核对是否语义重复，重复则归档源文件）`);
      }
    }
    for (const m of moves) {
      const to = path.join(root, m.to);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(path.join(root, m.from), to);
    }
    if (updateRefs && moves.length) {
      const dodPath = path.join(root, 'DoD.md');
      if (fs.existsSync(dodPath)) {
        let dod = fs.readFileSync(dodPath, 'utf8');
        for (const m of moves) dod = dod.split(m.from).join(m.to);
        fs.writeFileSync(dodPath, dod);
      }
    }
  }
  return plan;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--sprint');
  const sprintDir = i >= 0 ? args[i + 1] : null;
  if (!sprintDir) {
    console.error('用法: node scripts/graduate-sprint-tests.mjs --sprint <dir> [--dry-run] [--update-refs]');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const updateRefs = args.includes('--update-refs');
  const root = path.resolve(fileURLToPath(import.meta.url), '../..');
  const plan = graduate(root, sprintDir, { dryRun, updateRefs });
  const moves = [...plan.tests, ...plan.e2e];
  console.log(`毕业搬运${dryRun ? '（dry-run，未落盘）' : ''}: ${sprintDir}`);
  if (!moves.length) {
    console.log('  无可毕业文件（sprint 无 tests/ 且无 e2e-verify.sh）');
  }
  for (const m of moves) console.log(`  ${m.from} -> ${m.to}`);
  if (moves.length && !dryRun) {
    console.log('提示：记得下调 scripts/test-pyramid-baseline.json 的 orphans 锁住战果');
  }
}
