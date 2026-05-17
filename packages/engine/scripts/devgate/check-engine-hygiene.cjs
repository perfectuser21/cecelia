#!/usr/bin/env node
/**
 * check-engine-hygiene.cjs
 *
 * DevGate: scan packages/engine/** for lingering debris and dangling
 * references that accumulate between Superpowers alignment passes.
 *
 * Checks:
 *   1. No "manual:TODO" string anywhere under .md/.sh/.cjs files.
 *   2. No dangling refs to packages/engine/skills/dev/prompts/ (Phase 4
 *      deleted the local Superpowers copies; any reference is now broken).
 *      Use /superpowers:<skill-name> skill invocation instead.
 *   3. regression-contract.yaml must not have empty core[] / golden_paths[]
 *      (unless explicitly marked "allow_empty: true" on the same line).
 *   4. Engine version must be in sync across 5 files:
 *        packages/engine/VERSION
 *        packages/engine/package.json  (.version)
 *        packages/engine/.hook-core-version
 *        packages/engine/skills/dev/SKILL.md  (frontmatter version:)
 *        packages/engine/regression-contract.yaml  (top-level version:)
 *
 * Usage:
 *   node scripts/check-engine-hygiene.cjs [--verbose]
 *
 * Env:
 *   REPO_ROOT  override repo root (default: process.cwd())
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.env.REPO_ROOT || process.cwd();
const ENGINE_DIR = path.join(REPO_ROOT, 'packages', 'engine');
const VERBOSE = process.argv.includes('--verbose');

const TAG = '[check-engine-hygiene]';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Walk a directory tree recursively, returning files whose basename matches
 * one of the given extensions. Skips node_modules and common junk dirs.
 */
function walk(root, extensions) {
  const out = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name)) continue;
        stack.push(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (extensions.includes(ext)) out.push(full);
      }
    }
  }
  return out;
}

function relToRepo(absPath) {
  return path.relative(REPO_ROOT, absPath);
}

function readLines(absPath) {
  return fs.readFileSync(absPath, 'utf8').split(/\r?\n/);
}

// ---------------------------------------------------------------------------
// Check 1: no "manual:TODO"
// ---------------------------------------------------------------------------
function checkNoManualTodo(failures) {
  const files = walk(ENGINE_DIR, ['.md', '.sh', '.cjs']);
  let hits = 0;
  for (const file of files) {
    // DevGate scripts legitimately reference the forbidden string for detection
    // — self-exempt them from this check to avoid false positives.
    const rel = relToRepo(file);
    if (rel.startsWith('packages/engine/scripts/devgate/')) continue;
    const lines = readLines(file);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('manual:TODO')) {
        failures.push({
          check: 'no-manual-todo',
          file: rel,
          line: i + 1,
          msg: lines[i].trim(),
        });
        hits++;
      }
    }
  }
  if (VERBOSE) console.log(`${TAG} check1 no-manual-todo: scanned ${files.length} files, ${hits} hit(s)`);
}

// ---------------------------------------------------------------------------
// Check 2: no dangling references to deleted packages/engine/skills/dev/prompts/
// (Phase 4 deleted the local Superpowers copies; any reference is now broken.)
// ---------------------------------------------------------------------------
function checkNoDanglingPromptRefs(failures) {
  const re = /packages\/engine\/skills\/dev\/prompts\/[A-Za-z0-9_/.-]+\.md/g;
  const files = walk(ENGINE_DIR, ['.md']);
  let hits = 0;
  for (const file of files) {
    const lines = readLines(file);
    for (let i = 0; i < lines.length; i++) {
      const matches = lines[i].match(re);
      if (matches) {
        for (const m of matches) {
          failures.push({
            check: 'no-dangling-prompt-ref',
            file: relToRepo(file),
            line: i + 1,
            msg: `reference "${m}" — prompts/ deleted in Phase 4, use /superpowers:<skill-name> instead`,
          });
          hits++;
        }
      }
    }
  }
  if (VERBOSE) console.log(`${TAG} check2 no-dangling-prompt-ref: scanned ${files.length} files, ${hits} hit(s)`);
}

// ---------------------------------------------------------------------------
// Check 3: regression-contract.yaml core/golden_paths non-empty
// ---------------------------------------------------------------------------
function checkRegressionContractNonEmpty(failures) {
  const file = path.join(ENGINE_DIR, 'regression-contract.yaml');
  if (!fs.existsSync(file)) {
    failures.push({
      check: 'regression-contract-nonempty',
      file: 'packages/engine/regression-contract.yaml',
      line: 0,
      msg: 'file missing',
    });
    return;
  }
  const lines = readLines(file);
  // Naive top-level field detection: "^(core|golden_paths)\s*:\s*(.*)$"
  // We only consider lines with no leading indent (top-level keys).
  const topKeys = ['core', 'golden_paths'];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([a-z_]+):\s*(.*?)\s*(?:#.*)?$/);
    if (!m) continue;
    if (!topKeys.includes(m[1])) continue;
    const value = m[2];
    // Empty inline list?
    if (value === '[]') {
      const nextLine = (lines[i + 1] || '').trim();
      const allowEmpty = line.includes('allow_empty: true') || nextLine.includes('allow_empty: true');
      if (!allowEmpty) {
        failures.push({
          check: 'regression-contract-nonempty',
          file: 'packages/engine/regression-contract.yaml',
          line: i + 1,
          msg: `${m[1]} is empty list [] without allow_empty: true`,
        });
      }
    } else if (value === '') {
      // Block-style: look for sub-items starting with "-"
      let j = i + 1;
      let found = false;
      while (j < lines.length) {
        const sub = lines[j];
        if (/^\S/.test(sub) && sub.trim() !== '') break; // next top-level key
        if (/^\s+-\s+/.test(sub)) { found = true; break; }
        j++;
      }
      if (!found) {
        failures.push({
          check: 'regression-contract-nonempty',
          file: 'packages/engine/regression-contract.yaml',
          line: i + 1,
          msg: `${m[1]} has no items`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 4: version sync across 5 files
// ---------------------------------------------------------------------------
function getVersionFile(absPath) {
  if (!fs.existsSync(absPath)) return { version: null, reason: 'file missing' };
  return { version: fs.readFileSync(absPath, 'utf8').trim(), reason: null };
}

function getVersionPackageJson(absPath) {
  if (!fs.existsSync(absPath)) return { version: null, reason: 'file missing' };
  try {
    const obj = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    return { version: obj.version || null, reason: obj.version ? null : 'no version field' };
  } catch (err) {
    return { version: null, reason: `parse error: ${err.message}` };
  }
}

function getVersionSkillFrontmatter(absPath) {
  if (!fs.existsSync(absPath)) return { version: null, reason: 'file missing' };
  const lines = readLines(absPath);
  // Frontmatter is between first "---" and second "---", within first ~20 lines.
  let start = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].trim() === '---') { start = i; break; }
  }
  if (start === -1) return { version: null, reason: 'no frontmatter block' };
  for (let i = start + 1; i < Math.min(lines.length, start + 25); i++) {
    if (lines[i].trim() === '---') break;
    const m = lines[i].match(/^version:\s*(.+)\s*$/);
    if (m) return { version: m[1].trim().replace(/^["']|["']$/g, ''), reason: null };
  }
  return { version: null, reason: 'no version: in frontmatter' };
}

function getVersionRegressionYaml(absPath) {
  if (!fs.existsSync(absPath)) return { version: null, reason: 'file missing' };
  const lines = readLines(absPath);
  for (const line of lines) {
    const m = line.match(/^version:\s*(.+?)\s*(?:#.*)?$/);
    if (m) return { version: m[1].trim().replace(/^["']|["']$/g, ''), reason: null };
  }
  return { version: null, reason: 'no top-level version:' };
}

function checkVersionSync(failures) {
  const targets = [
    {
      name: 'VERSION',
      rel: 'packages/engine/VERSION',
      read: getVersionFile,
    },
    {
      name: 'package.json',
      rel: 'packages/engine/package.json',
      read: getVersionPackageJson,
    },
    {
      name: '.hook-core-version',
      rel: 'packages/engine/.hook-core-version',
      read: getVersionFile,
    },
    {
      name: 'hooks/VERSION',
      rel: 'packages/engine/hooks/VERSION',
      read: getVersionFile,
    },
    {
      name: 'skills/dev/SKILL.md',
      rel: 'packages/engine/skills/dev/SKILL.md',
      read: getVersionSkillFrontmatter,
    },
    {
      name: 'regression-contract.yaml',
      rel: 'packages/engine/regression-contract.yaml',
      read: getVersionRegressionYaml,
    },
  ];

  const results = targets.map(t => {
    const abs = path.join(REPO_ROOT, t.rel);
    const r = t.read(abs);
    return { ...t, version: r.version, reason: r.reason };
  });

  // Find the canonical version (first non-null is VERSION file if present).
  const reference = results.find(r => r.version !== null);
  if (!reference) {
    failures.push({
      check: 'version-sync',
      file: '(multiple)',
      line: 0,
      msg: 'no version found in any of the 5 target files',
    });
    return;
  }

  const mismatches = [];
  for (const r of results) {
    if (r.version === null) {
      mismatches.push({ r, detail: r.reason || 'missing' });
    } else if (r.version !== reference.version) {
      mismatches.push({ r, detail: `has "${r.version}" (expected "${reference.version}")` });
    }
  }

  if (mismatches.length > 0) {
    console.log('');
    console.log(`${TAG} version sync report:`);
    for (const r of results) {
      const ok = r.version === reference.version;
      const mark = ok ? 'OK  ' : 'FAIL';
      console.log(`  [${mark}] ${r.name.padEnd(26)} ${r.version === null ? '(none)' : r.version}${r.reason ? ` — ${r.reason}` : ''}`);
    }
    console.log('');
    for (const m of mismatches) {
      failures.push({
        check: 'version-sync',
        file: m.r.rel,
        line: 0,
        msg: `${m.r.name}: ${m.detail}`,
      });
    }
  } else if (VERBOSE) {
    console.log(`${TAG} version sync: all 5 files at "${reference.version}"`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(ENGINE_DIR)) {
    console.error(`${TAG} ERROR: engine directory not found: ${ENGINE_DIR}`);
    process.exit(1);
  }

  console.log(`${TAG} scanning ${path.relative(REPO_ROOT, ENGINE_DIR)}/ ...`);

  const failures = [];
  checkNoManualTodo(failures);
  checkNoDanglingPromptRefs(failures);
  checkRegressionContractNonEmpty(failures);
  checkVersionSync(failures);

  if (failures.length > 0) {
    console.log('');
    console.log(`[FAIL] ${failures.length} hygiene violation(s):`);
    for (const f of failures) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      console.log(`  [${f.check}] ${loc}  ${f.msg}`);
    }
    process.exit(1);
  }

  console.log(`[OK] Engine hygiene: all checks passed`);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`${TAG} FATAL: ${err && err.stack ? err.stack : err}`);
  process.exit(2);
}
