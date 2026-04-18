#!/usr/bin/env node
/**
 * check-superpowers-alignment.cjs
 *
 * DevGate: verify packages/engine/contracts/superpowers-alignment.yaml
 * is in sync with the actual Engine repository.
 *
 * For every skill declared in the contract:
 *   - coverage_level in {full, partial}:
 *     - engine_integration.anchor_file must exist
 *     - every required_keywords entry must appear in that anchor_file
 *     - if local_prompt.path exists, its sha256 must match local_prompt.sha256
 *       (a sha256 value starting with "PENDING_" is tolerated with a warning)
 *   - coverage_level == rejected:
 *     - rejection_reason must be present and non-empty
 *
 * Any violation -> exit 1. All clean -> exit 0.
 *
 * Usage:
 *   node scripts/check-superpowers-alignment.cjs [--verbose]
 *
 * Env:
 *   REPO_ROOT  override repo root (default: process.cwd())
 *
 * Dependencies: node >=18. js-yaml if available, otherwise a built-in
 * minimal parser handles the structured contract file.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = process.env.REPO_ROOT || process.cwd();
const VERBOSE = process.argv.includes('--verbose');

const CONTRACT_REL = 'packages/engine/contracts/superpowers-alignment.yaml';
const CONTRACT_ABS = path.join(REPO_ROOT, CONTRACT_REL);

const TAG = '[check-superpowers-alignment]';

// ---------------------------------------------------------------------------
// YAML loader: try js-yaml, fall back to a minimal parser that handles the
// subset of YAML used by the alignment contract.
// ---------------------------------------------------------------------------
function loadYaml(text) {
  try {
    // eslint-disable-next-line global-require
    const yaml = require('js-yaml');
    return yaml.load(text);
  } catch (_err) {
    return parseYamlMinimal(text);
  }
}

/**
 * Minimal YAML parser sufficient for superpowers-alignment.yaml.
 *
 * Supports:
 *   - nested mappings (2-space indentation)
 *   - sequences of mappings ("- key: value" blocks)
 *   - scalar sequences ("- item")
 *   - scalar values (quoted or unquoted)
 *   - null / true / false
 *   - comments (#...) and blank lines
 *
 * Does NOT support flow style, anchors, aliases, multiline scalars,
 * or block scalars. That is intentional: the contract file is authored
 * in strict block style.
 */
function parseYamlMinimal(text) {
  const rawLines = text.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    // strip comment tail (but not inside quotes)
    const stripped = stripInlineComment(line);
    if (stripped.trim() === '') continue;
    const indent = stripped.match(/^ */)[0].length;
    lines.push({ indent, content: stripped.slice(indent), lineno: i + 1 });
  }

  let idx = 0;

  function parseBlock(minIndent) {
    // Peek: if first non-blank line is "- ", parse sequence; else map.
    if (idx >= lines.length) return null;
    const first = lines[idx];
    if (first.indent < minIndent) return null;
    if (first.content.startsWith('- ') || first.content === '-') {
      return parseSequence(first.indent);
    }
    return parseMapping(first.indent);
  }

  function parseMapping(indent) {
    const out = {};
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new Error(`YAML parse error at line ${line.lineno}: unexpected indent`);
      }
      const m = line.content.match(/^([^:\s][^:]*?)\s*:\s*(.*)$/);
      if (!m) {
        throw new Error(`YAML parse error at line ${line.lineno}: expected "key: value"`);
      }
      const key = m[1].trim();
      const valueRaw = m[2];
      idx++;
      // Block scalar indicators (| and >) — consume subsequent indented lines as a single string.
      // We don't need the exact text, but we must skip them to avoid indent errors.
      if (valueRaw === '|' || valueRaw === '>' || valueRaw.startsWith('|') || valueRaw.startsWith('>')) {
        const blockLines = [];
        while (idx < lines.length && lines[idx].indent > indent) {
          blockLines.push(lines[idx].content);
          idx++;
        }
        out[key] = blockLines.join('\n');
        continue;
      }
      if (valueRaw === '' || valueRaw === null) {
        // nested block
        if (idx < lines.length && lines[idx].indent > indent) {
          out[key] = parseBlock(lines[idx].indent);
        } else {
          out[key] = null;
        }
      } else {
        out[key] = parseScalar(valueRaw);
      }
    }
    return out;
  }

  function parseSequence(indent) {
    const out = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new Error(`YAML parse error at line ${line.lineno}: unexpected indent in sequence`);
      }
      if (!(line.content.startsWith('- ') || line.content === '-')) break;
      const rest = line.content === '-' ? '' : line.content.slice(2);
      idx++;
      if (rest === '') {
        // nested block item
        if (idx < lines.length && lines[idx].indent > indent) {
          out.push(parseBlock(lines[idx].indent));
        } else {
          out.push(null);
        }
      } else if (/^[^:\s][^:]*?:\s*/.test(rest)) {
        // inline mapping start: "- key: value"
        // We splice this back into `lines` as an inner mapping at indent+2.
        const inner = { indent: indent + 2, content: rest, lineno: line.lineno };
        lines.splice(idx, 0, inner);
        const item = parseMapping(indent + 2);
        out.push(item);
      } else {
        out.push(parseScalar(rest));
      }
    }
    return out;
  }

  function parseScalar(raw) {
    const v = raw.trim();
    if (v === '' || v === '~' || v.toLowerCase() === 'null') return null;
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  const result = parseBlock(0);
  return result == null ? {} : result;
}

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readFileOrNull(absPath) {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch (_err) {
    return null;
  }
}

function sha256OfFile(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normalizeKeywords(list) {
  if (!list) return [];
  if (!Array.isArray(list)) return [String(list)];
  return list.map(String);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  console.log(`${TAG} Reading ${CONTRACT_REL}...`);

  if (!fs.existsSync(CONTRACT_ABS)) {
    console.error(`${TAG} ERROR: contract file not found: ${CONTRACT_ABS}`);
    process.exit(1);
  }

  let contract;
  try {
    const raw = fs.readFileSync(CONTRACT_ABS, 'utf8');
    contract = loadYaml(raw);
  } catch (err) {
    console.error(`${TAG} ERROR: failed to parse YAML: ${err.message}`);
    process.exit(1);
  }

  const skills = Array.isArray(contract && contract.skills) ? contract.skills : [];
  if (skills.length === 0) {
    console.error(`${TAG} ERROR: no skills[] found in contract`);
    process.exit(1);
  }

  console.log(`${TAG} ${skills.length} skills declared`);
  console.log('');

  const failures = [];
  const warnings = [];
  let verified = 0;

  for (const skill of skills) {
    if (!skill || typeof skill !== 'object') {
      failures.push({ name: '<unknown>', msg: 'skill entry is not a mapping' });
      continue;
    }

    const name = skill.name || '<unnamed>';
    const level = skill.coverage_level || 'unknown';

    if (level === 'rejected') {
      const reason = skill.rejection_reason;
      if (!reason || String(reason).trim() === '') {
        failures.push({ name, msg: `coverage_level=rejected but rejection_reason is missing/empty` });
        console.log(`[FAIL] ${name} (rejected)`);
        console.log(`       rejection_reason missing`);
      } else {
        console.log(`[OK]   ${name} (rejected)`);
        if (VERBOSE) console.log(`       reason: ${reason}`);
        verified++;
      }
      continue;
    }

    if (level !== 'full' && level !== 'partial') {
      // Unknown levels are treated as out-of-scope: neither pass nor fail.
      console.log(`[SKIP] ${name} (coverage_level=${level})`);
      continue;
    }

    const localFailures = [];
    const localWarnings = [];

    const ei = skill.engine_integration || {};
    const anchorRel = ei.anchor_file;
    let anchorAbs = null;
    let anchorText = null;

    if (!anchorRel) {
      localFailures.push('engine_integration.anchor_file missing');
    } else {
      anchorAbs = path.join(REPO_ROOT, anchorRel);
      anchorText = readFileOrNull(anchorAbs);
      if (anchorText === null) {
        localFailures.push(`anchor_file not found on disk: ${anchorRel}`);
      }
    }

    const keywords = normalizeKeywords(ei.required_keywords);
    const missingKeywords = [];
    if (anchorText !== null && keywords.length > 0) {
      for (const kw of keywords) {
        if (!anchorText.includes(kw)) missingKeywords.push(kw);
      }
      if (missingKeywords.length > 0) {
        localFailures.push(
          `${keywords.length - missingKeywords.length}/${keywords.length} keywords found ` +
          `(MISSING: ${missingKeywords.map(k => JSON.stringify(k)).join(', ')})`
        );
      }
    }

    const lp = skill.local_prompt;
    let localPromptStatus = null;
    if (lp && lp.path) {
      const lpAbs = path.join(REPO_ROOT, lp.path);
      if (!fs.existsSync(lpAbs)) {
        localFailures.push(`local_prompt.path not found on disk: ${lp.path}`);
      } else {
        const expected = lp.sha256 ? String(lp.sha256) : '';
        if (!expected) {
          localWarnings.push(`local_prompt present but sha256 missing`);
          localPromptStatus = 'sha256 missing (warn)';
        } else if (expected.startsWith('PENDING_')) {
          localWarnings.push(`local_prompt sha256 is ${expected} (pending — skipped)`);
          localPromptStatus = `${expected} (pending)`;
        } else {
          const actual = sha256OfFile(lpAbs);
          if (actual !== expected) {
            localFailures.push(
              `local_prompt sha256 mismatch (expected ${expected}, actual ${actual})`
            );
            localPromptStatus = 'sha256 MISMATCH';
          } else {
            localPromptStatus = 'sha256 OK';
          }
        }
      }
    }

    const passed = localFailures.length === 0;
    const marker = passed ? '[OK]  ' : '[FAIL]';
    console.log(`${marker} ${name} (${level})`);
    if (anchorRel) console.log(`       anchor: ${anchorRel}`);
    if (keywords.length > 0) {
      console.log(`       keywords: ${keywords.length - missingKeywords.length}/${keywords.length} found`);
    }
    if (lp && lp.path) {
      console.log(`       local_prompt: ${lp.path}${localPromptStatus ? ` (${localPromptStatus})` : ''}`);
    }
    if (VERBOSE || !passed) {
      for (const msg of localFailures) console.log(`       - FAIL: ${msg}`);
      for (const msg of localWarnings) console.log(`       - WARN: ${msg}`);
    }

    if (passed) verified++;
    for (const msg of localFailures) failures.push({ name, msg });
    for (const msg of localWarnings) warnings.push({ name, msg });
  }

  console.log('');
  if (warnings.length > 0 && VERBOSE) {
    console.log(`${TAG} warnings:`);
    for (const w of warnings) console.log(`  - ${w.name}: ${w.msg}`);
    console.log('');
  }

  if (failures.length > 0) {
    console.log(`[FAIL] ${failures.length} violation(s) across ${new Set(failures.map(f => f.name)).size} skill(s)`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.msg}`);
    process.exit(1);
  }

  console.log(`[OK] Superpowers alignment: ${verified} skill(s) verified`);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`${TAG} FATAL: ${err && err.stack ? err.stack : err}`);
  process.exit(2);
}
