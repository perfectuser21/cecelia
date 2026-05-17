#!/usr/bin/env node
/**
 * ci-evolution-check.mjs — CI Evolution Gate v1
 *
 * Detects structural changes that require CI registration:
 *   1. New package/app directories not registered in ci/routing-map.yml
 *   2. New top-level test directories not classified in ci/test-taxonomy.yml
 *
 * Usage:
 *   node scripts/ci-evolution-check.mjs
 *
 * Exit codes:
 *   0 = all registered, no structural gaps detected
 *   1 = unregistered subsystem or uncovered test category detected
 *
 * DOES NOT:
 *   - Automatically rewrite any CI file
 *   - Infer CI semantics from directory names
 *   - Break existing pipelines
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Simple YAML Extractor ─────────────────────────────────────────────────
// Purpose-built parser for our controlled registry format.
// Handles: top-level section keys, `root:`, `roots:`, `ci_exempt:`, `layer:`

/**
 * Extract all registered root paths from routing-map.yml.
 * Returns a Map<subsystem_name, { roots: string[], ci_exempt: boolean }>
 */
function parseRoutingMap(content) {
  const lines = content.split('\n');
  const subsystems = {};
  let inSubsystems = false;
  let currentName = null;
  let currentIndent = null;
  let inRootsList = false;

  for (const line of lines) {
    // Enter the subsystems: section
    if (/^subsystems:\s*$/.test(line)) {
      inSubsystems = true;
      continue;
    }

    // Leave the subsystems: section (new top-level section)
    if (inSubsystems && /^[a-zA-Z]/.test(line) && !line.startsWith(' ')) {
      if (!line.startsWith('subsystems:')) {
        inSubsystems = false;
      }
      continue;
    }

    if (!inSubsystems) continue;

    // Detect a subsystem entry (2-space indent + name + colon)
    const entryMatch = line.match(/^  ([a-zA-Z][a-zA-Z0-9_-]+):\s*$/);
    if (entryMatch) {
      currentName = entryMatch[1];
      subsystems[currentName] = { roots: [], ci_exempt: false };
      inRootsList = false;
      continue;
    }

    if (!currentName) continue;

    // single root: value
    const rootMatch = line.match(/^\s{4,}root:\s+(.+)$/);
    if (rootMatch) {
      subsystems[currentName].roots.push(rootMatch[1].trim());
      inRootsList = false;
      continue;
    }

    // roots: [a, b, c]  — inline array
    const rootsInlineMatch = line.match(/^\s{4,}roots:\s*\[(.+)\]\s*$/);
    if (rootsInlineMatch) {
      const items = rootsInlineMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      subsystems[currentName].roots.push(...items);
      inRootsList = false;
      continue;
    }

    // roots:            — block array start
    const rootsBlockMatch = line.match(/^\s{4,}roots:\s*$/);
    if (rootsBlockMatch) {
      inRootsList = true;
      continue;
    }

    // - item           — block array item
    if (inRootsList) {
      const itemMatch = line.match(/^\s{6,}-\s+(.+)$/);
      if (itemMatch) {
        subsystems[currentName].roots.push(itemMatch[1].trim());
        continue;
      }
      // any non-item line ends the roots list
      if (line.trim() !== '') {
        inRootsList = false;
      }
    }

    // ci_exempt: true
    if (/^\s{4,}ci_exempt:\s+true/.test(line)) {
      subsystems[currentName].ci_exempt = true;
    }
  }

  return subsystems;
}

/**
 * Extract all test pattern groups from test-taxonomy.yml.
 * Returns a Map<type_name, { patterns: string[], layer: string }>
 */
function parseTestTaxonomy(content) {
  const lines = content.split('\n');
  const types = {};
  let inTestTypes = false;
  let currentType = null;
  let inPatterns = false;

  for (const line of lines) {
    if (/^test_types:\s*$/.test(line)) {
      inTestTypes = true;
      continue;
    }
    if (inTestTypes && /^[a-zA-Z]/.test(line) && !line.startsWith(' ')) {
      inTestTypes = false;
      continue;
    }
    if (!inTestTypes) continue;

    // type entry
    const entryMatch = line.match(/^  ([a-zA-Z][a-zA-Z0-9_-]+):\s*$/);
    if (entryMatch) {
      currentType = entryMatch[1];
      types[currentType] = { patterns: [], layer: null };
      inPatterns = false;
      continue;
    }

    if (!currentType) continue;

    // patterns:
    if (/^\s{4,}patterns:\s*$/.test(line)) {
      inPatterns = true;
      continue;
    }

    if (inPatterns) {
      const patternMatch = line.match(/^\s{6,}-\s+"?(.+?)"?\s*$/);
      if (patternMatch) {
        types[currentType].patterns.push(patternMatch[1].trim());
        continue;
      }
      if (line.trim() !== '') {
        inPatterns = false;
      }
    }

    // layer: lN
    const layerMatch = line.match(/^\s{4,}layer:\s+(\S+)/);
    if (layerMatch) {
      types[currentType].layer = layerMatch[1].trim();
    }
  }

  return types;
}

// ─── Directory Scanners ────────────────────────────────────────────────────

function listSubdirs(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .filter(name => {
      try {
        return statSync(join(dirPath, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map(name => join(dirPath, name).replace(/\\/g, '/'));
}

/**
 * Check whether a test directory path is covered by any pattern in the taxonomy.
 * Uses glob-like matching (simplified: * matches path segments, ** matches any).
 */
function isTestDirCovered(testDir, taxonomy) {
  const normalizedDir = testDir.replace(/\\/g, '/').replace(/\/$/, '');

  for (const [, entry] of Object.entries(taxonomy)) {
    for (const pattern of entry.patterns) {
      // Strip trailing /** so directory itself can match (e.g. "foo/tests/**" → "foo/tests")
      const dirPattern = pattern.replace(/\/\*\*$/, '').replace(/\*\*$/, '');

      const regexStr = dirPattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '___GLOBSTAR___')
        .replace(/\*/g, '[^/]*')
        .replace(/___GLOBSTAR___/g, '.*');
      const regex = new RegExp(`^${regexStr}`, 'i');
      if (regex.test(normalizedDir)) return true;
    }
  }
  return false;
}

/**
 * Find top-level named test directories (not __tests__, those are standard).
 * Looks for directories named "tests", "e2e", "integration", "performance", etc.
 */
function findNamedTestDirs(baseDir, knownNames) {
  const results = [];
  if (!existsSync(baseDir)) return results;

  function recurse(dir, depth) {
    if (depth > 4) return; // don't go too deep
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === 'node_modules' || name.startsWith('.')) continue;

      const fullPath = join(dir, name).replace(/\\/g, '/');

      // Named test directories (not __tests__ which is standard)
      if (knownNames.has(name) && name !== '__tests__') {
        results.push(fullPath);
      }
      recurse(fullPath, depth + 1);
    }
  }

  recurse(baseDir, 0);
  return results;
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  const LINE = '━'.repeat(50);
  console.log(LINE);
  console.log('  CI Evolution Gate v1');
  console.log(LINE);
  console.log('');

  const routingMapPath = resolve(ROOT, 'ci/routing-map.yml');
  const testTaxonomyPath = resolve(ROOT, 'ci/test-taxonomy.yml');

  // ── Load Registry Files ──────────────────────────────────────────────────

  if (!existsSync(routingMapPath)) {
    console.error('❌ FAIL: ci/routing-map.yml not found');
    console.error('   Create it to register subsystems.');
    console.error('   See: https://github.com/perfectuser21/cecelia/blob/main/ci/routing-map.yml');
    process.exit(1);
  }

  if (!existsSync(testTaxonomyPath)) {
    console.error('❌ FAIL: ci/test-taxonomy.yml not found');
    console.error('   Create it to classify test types.');
    process.exit(1);
  }

  const routingContent = readFileSync(routingMapPath, 'utf8');
  const taxonomyContent = readFileSync(testTaxonomyPath, 'utf8');

  const subsystems = parseRoutingMap(routingContent);
  const testTypes = parseTestTaxonomy(taxonomyContent);

  // Build the set of all registered root paths
  const registeredRoots = new Set();
  for (const [, entry] of Object.entries(subsystems)) {
    for (const root of entry.roots) {
      registeredRoots.add(root.replace(/\\/g, '/'));
    }
  }

  console.log(`📋 Registered subsystems (${Object.keys(subsystems).length}):`);
  for (const [name, entry] of Object.entries(subsystems)) {
    const exempt = entry.ci_exempt ? ' [ci_exempt]' : '';
    const roots = entry.roots.join(', ');
    console.log(`   ${name}${exempt}: ${roots}`);
  }

  console.log('');
  console.log(`📋 Registered test types (${Object.keys(testTypes).length}):`);
  for (const [name, entry] of Object.entries(testTypes)) {
    console.log(`   ${name} → ${entry.layer} (${entry.patterns.length} patterns)`);
  }

  console.log('');

  const errors = [];
  const warnings = [];

  // ── Check 1: Unregistered packages/* directories ─────────────────────────

  console.log('🔍 Check 1: packages/* subsystem registration');
  const pkgDirs = listSubdirs(resolve(ROOT, 'packages'));

  for (const dir of pkgDirs) {
    const relDir = dir.replace(ROOT + '/', '').replace(ROOT + '\\', '');
    if (!registeredRoots.has(relDir)) {
      errors.push(
        `New subsystem detected: ${relDir}/\n` +
        `   → Register it in ci/routing-map.yml before merging.\n` +
        `   → Specify layers, deploy flag, and a description.\n` +
        `   Example:\n` +
        `     ${relDir.split('/').pop()}:\n` +
        `       root: ${relDir}\n` +
        `       layers: [l3]\n` +
        `       deploy: false`
      );
    } else {
      console.log(`   ✅ ${relDir}`);
    }
  }

  if (pkgDirs.length === 0) {
    console.log('   (no packages/ directories found)');
  }

  // ── Check 2: Unregistered apps/* directories ─────────────────────────────

  console.log('');
  console.log('🔍 Check 2: apps/* deployable registration');
  const appDirs = listSubdirs(resolve(ROOT, 'apps'));

  for (const dir of appDirs) {
    const relDir = dir.replace(ROOT + '/', '').replace(ROOT + '\\', '');
    if (!registeredRoots.has(relDir)) {
      errors.push(
        `New deployable app detected: ${relDir}/\n` +
        `   → Declare it in the 'workspace.roots' list in ci/routing-map.yml.\n` +
        `   → If it's a standalone service, create a new subsystem entry.\n` +
        `   Example (add to workspace.roots):\n` +
        `       roots:\n` +
        `         - apps/api\n` +
        `         - apps/dashboard\n` +
        `         - ${relDir}   # ← add this`
      );
    } else {
      console.log(`   ✅ ${relDir}`);
    }
  }

  if (appDirs.length === 0) {
    console.log('   (no apps/ directories found)');
  }

  // ── Check 4: scripts/devgate registration ────────────────────────────────
  // Ensures the DevGate scripts directory is tracked in routing-map.yml.
  // Any new script added here should remain covered by the existing entry.

  console.log('');
  console.log('🔍 Check 4: scripts/devgate registration');
  {
    const devgatePath = 'scripts/devgate';
    if (!existsSync(resolve(ROOT, devgatePath))) {
      console.log(`   (scripts/devgate not found, skipping)`);
    } else if (!registeredRoots.has(devgatePath)) {
      errors.push(
        `scripts/devgate is not registered in ci/routing-map.yml\n` +
        `   → Add a 'devgate-core' entry with root: scripts/devgate.\n` +
        `   Example:\n` +
        `     devgate-core:\n` +
        `       root: scripts/devgate\n` +
        `       layers: [l1, l2]\n` +
        `       deploy: false`
      );
    } else {
      console.log(`   ✅ scripts/devgate`);
    }
  }

  // ── Check 5: ci/ configuration registration ──────────────────────────────
  // Ensures ci/routing-map.yml and ci/test-taxonomy.yml are themselves tracked.

  console.log('');
  console.log('🔍 Check 5: ci/ configuration registration');
  {
    const ciPath = 'ci';
    if (!existsSync(resolve(ROOT, ciPath))) {
      console.log(`   (ci/ not found, skipping)`);
    } else if (!registeredRoots.has(ciPath)) {
      errors.push(
        `ci/ directory is not registered in ci/routing-map.yml\n` +
        `   → Add a 'ci-configuration' entry with root: ci.\n` +
        `   Example:\n` +
        `     ci-configuration:\n` +
        `       root: ci\n` +
        `       layers: [l2]\n` +
        `       deploy: false`
      );
    } else {
      console.log(`   ✅ ci`);
    }
  }

  // ── Check 6: .github/workflows registration ──────────────────────────────
  // Ensures GitHub Actions workflow definitions are tracked in routing-map.yml.

  console.log('');
  console.log('🔍 Check 6: .github/workflows registration');
  {
    const ghwPath = '.github/workflows';
    if (!existsSync(resolve(ROOT, ghwPath))) {
      console.log(`   (.github/workflows not found, skipping)`);
    } else if (!registeredRoots.has(ghwPath)) {
      errors.push(
        `.github/workflows is not registered in ci/routing-map.yml\n` +
        `   → Add a 'github-workflows' entry with root: .github/workflows.\n` +
        `   Example:\n` +
        `     github-workflows:\n` +
        `       root: .github/workflows\n` +
        `       layers: [l1, l2]\n` +
        `       deploy: false`
      );
    } else {
      console.log(`   ✅ .github/workflows`);
    }
  }

  // ── Check 3: Unclassified test directories ────────────────────────────────

  console.log('');
  console.log('🔍 Check 3: test directory taxonomy classification');

  // Named test directories that represent a test "category" (not __tests__)
  const TEST_CATEGORY_NAMES = new Set([
    'tests', 'test', 'e2e', 'integration', 'performance',
    'benchmark', 'smoke', 'regression', 'fixtures', 'mocks',
  ]);

  const namedTestDirs = findNamedTestDirs(ROOT, TEST_CATEGORY_NAMES);
  // Exclude node_modules paths
  const filteredTestDirs = namedTestDirs.filter(d => !d.includes('node_modules'));

  for (const dir of filteredTestDirs) {
    const relDir = dir.replace(ROOT + '/', '').replace(ROOT + '\\', '');
    if (!isTestDirCovered(relDir, testTypes)) {
      warnings.push(
        `Unclassified test directory: ${relDir}/\n` +
        `   → Add a pattern for it in ci/test-taxonomy.yml.\n` +
        `   → Specify which layer (l3 or l4) should run these tests.`
      );
    } else {
      console.log(`   ✅ ${relDir}`);
    }
  }

  if (filteredTestDirs.length === 0) {
    console.log('   (no named test directories found)');
  }

  // ── Results ───────────────────────────────────────────────────────────────

  console.log('');
  console.log(LINE);

  if (warnings.length > 0) {
    console.log('  ⚠️  Warnings (should classify, not blocking)');
    console.log(LINE);
    for (const w of warnings) {
      console.warn('');
      console.warn('⚠️  WARNING:', w);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.log('  ❌ CI Evolution Gate FAILED');
    console.log(LINE);
    for (const e of errors) {
      console.error('');
      console.error('❌ ERROR:', e);
    }
    console.log('');
    console.log(`${errors.length} error(s) found. Fix them before merging.`);
    console.log('');
    console.log('HOW TO FIX:');
    console.log('  1. Open ci/routing-map.yml');
    console.log('  2. Add the missing subsystem entry');
    console.log('  3. Run: node scripts/ci-evolution-check.mjs');
    console.log('  4. Verify it exits with code 0');
    process.exit(1);
  }

  console.log('  ✅ CI Evolution Gate PASSED');
  console.log(LINE);
  console.log('');
  console.log(`All ${registeredRoots.size} roots registered. No structural gaps detected.`);
  console.log('');
}

main();
