/**
 * scan-code-dedup.mjs — Brain 代码去重扫描引擎
 *
 * 扫描 packages/brain/src/ 下所有 .js 文件，找出重复代码块。
 * 算法：滑动窗口 hash，窗口大小 8 行（去除注释/空行后）。
 *
 * 用法：
 *   node packages/brain/scripts/scan-code-dedup.mjs             # 人类可读输出
 *   node packages/brain/scripts/scan-code-dedup.mjs --json      # JSON 格式
 *   node packages/brain/scripts/scan-code-dedup.mjs --baseline  # 保存基线到 dedup-baseline.json
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, resolve, relative } from 'path';
import { createHash } from 'crypto';

const WINDOW_SIZE = 8;       // 滑动窗口行数（去注释空行后）
const MIN_TOKENS = 30;       // 窗口最少 token 数（过滤低信息量行）
const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '../../..');
const SCAN_DIRS = [
  'packages/brain/src',
];
const EXCLUDE_PATTERNS = [
  '__tests__',
  'node_modules',
  '.min.js',
  'brain-manifest.generated.json',
];

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some(p => filePath.includes(p));
}

function collectFiles(dir, ext = '.js') {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (isExcluded(full)) continue;
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * 规范化代码行：去掉注释、空行、纯括号行。
 * 返回 { normalized, original } 对数组。
 */
function extractNormalizedLines(content) {
  const lines = content.split('\n');
  const result = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 块注释处理
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.trimStart().startsWith('/*') || line.trimStart().startsWith('/**')) {
      inBlockComment = !line.includes('*/');
      continue;
    }

    // 行注释、空行、纯括号
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed === '{' || trimmed === '}' || trimmed === '};') {
      continue;
    }

    // 规范化：去掉行尾注释、多余空白
    const normalized = trimmed.replace(/\/\/.*$/, '').trim();
    if (normalized.length < 4) continue;

    result.push({ normalized, original: line, lineNum: i + 1 });
  }
  return result;
}

function tokenCount(str) {
  return str.split(/\s+/).filter(Boolean).length;
}

function hashWindow(lines) {
  const content = lines.map(l => l.normalized).join('\n');
  return createHash('sha1').update(content).digest('hex');
}

// ─── 核心扫描 ─────────────────────────────────────────────────────────────────

function scanFiles(files) {
  // hash → [{ file, startLine, endLine, lines }]
  const hashMap = new Map();

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf8');
    const lines = extractNormalizedLines(content);

    for (let i = 0; i <= lines.length - WINDOW_SIZE; i++) {
      const window = lines.slice(i, i + WINDOW_SIZE);
      const tokens = window.reduce((sum, l) => sum + tokenCount(l.normalized), 0);
      if (tokens < MIN_TOKENS) continue;

      const hash = hashWindow(window);
      if (!hashMap.has(hash)) hashMap.set(hash, []);
      hashMap.get(hash).push({
        file: relative(REPO_ROOT, filePath),
        startLine: window[0].lineNum,
        endLine: window[window.length - 1].lineNum,
        preview: window[0].normalized.substring(0, 80),
      });
    }
  }

  // 只保留出现 ≥2 次的窗口（真正重复）
  const duplicates = [];
  for (const [hash, occurrences] of hashMap.entries()) {
    // 去掉同文件内相邻重叠窗口（滑动窗口自然产生的伪重复）
    const deduped = deduplicateSameFile(occurrences);
    if (deduped.length >= 2) {
      duplicates.push({ hash, occurrences: deduped, count: deduped.length });
    }
  }

  return duplicates;
}

/**
 * 同一文件内，若两个窗口起始行相差 < WINDOW_SIZE，视为滑动重叠，只保留第一个。
 */
function deduplicateSameFile(occurrences) {
  const byFile = new Map();
  for (const occ of occurrences) {
    if (!byFile.has(occ.file)) byFile.set(occ.file, []);
    byFile.get(occ.file).push(occ);
  }

  const result = [];
  for (const [, occs] of byFile.entries()) {
    occs.sort((a, b) => a.startLine - b.startLine);
    let lastKept = null;
    for (const occ of occs) {
      if (!lastKept || occ.startLine - lastKept.startLine >= WINDOW_SIZE) {
        result.push(occ);
        lastKept = occ;
      }
    }
  }
  return result;
}

// ─── 统计与报告 ───────────────────────────────────────────────────────────────

function buildReport(files, duplicates) {
  // 计算重复行数
  const duplicateLineSet = new Set();
  for (const dup of duplicates) {
    for (const occ of dup.occurrences) {
      for (let l = occ.startLine; l <= occ.endLine; l++) {
        duplicateLineSet.add(`${occ.file}:${l}`);
      }
    }
  }

  // 统计总行数（规范化后）
  let totalNormalizedLines = 0;
  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    totalNormalizedLines += extractNormalizedLines(content).length;
  }

  const dupPct = totalNormalizedLines > 0
    ? Math.round((duplicateLineSet.size / totalNormalizedLines) * 100 * 10) / 10
    : 0;

  // Top 10 重复块（按出现次数排序）
  const top = duplicates
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(d => ({
      count: d.count,
      preview: d.occurrences[0].preview,
      locations: d.occurrences.map(o => `${o.file}:${o.startLine}`),
    }));

  // 重复最多的文件
  const fileScore = {};
  for (const dup of duplicates) {
    for (const occ of dup.occurrences) {
      fileScore[occ.file] = (fileScore[occ.file] || 0) + WINDOW_SIZE;
    }
  }
  const topFiles = Object.entries(fileScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, dupLines]) => ({ file, dupLines }));

  return {
    scanned_at: new Date().toISOString(),
    scan_dirs: SCAN_DIRS,
    total_files: files.length,
    total_normalized_lines: totalNormalizedLines,
    duplicate_lines: duplicateLineSet.size,
    duplication_pct: dupPct,
    duplicate_blocks: duplicates.length,
    top_duplicates: top,
    top_files_by_duplication: topFiles,
  };
}

// ─── 覆盖率验证 ───────────────────────────────────────────────────────────────

function verifyCoverage(files, report) {
  const issues = [];

  // 1. 确认所有扫描目录文件都被覆盖
  for (const dir of SCAN_DIRS) {
    const absDir = join(REPO_ROOT, dir);
    if (!existsSync(absDir)) {
      issues.push(`MISSING_DIR: ${dir} 不存在`);
    }
  }

  // 2. 文件数量合理性检查（Brain src 应有 >100 个文件）
  if (report.total_files < 50) {
    issues.push(`LOW_FILE_COUNT: 只扫描了 ${report.total_files} 个文件，预期 >100`);
  }

  // 3. 规范化行数合理性（Brain src 应有 >10000 行代码）
  if (report.total_normalized_lines < 5000) {
    issues.push(`LOW_LINE_COUNT: 只有 ${report.total_normalized_lines} 行规范化代码，预期 >5000`);
  }

  // 4. 已知高风险文件确认扫描到
  const HIGH_RISK_FILES = ['packages/brain/src/executor.js', 'packages/brain/src/thalamus.js'];
  const scannedRelative = files.map(f => relative(REPO_ROOT, f));
  for (const f of HIGH_RISK_FILES) {
    if (!scannedRelative.includes(f)) {
      issues.push(`MISSING_FILE: ${f} 未被扫描`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    coverage_pct: Math.round((report.total_files / (report.total_files + issues.length)) * 100),
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const baselineMode = args.includes('--baseline');

const files = [];
for (const dir of SCAN_DIRS) {
  const absDir = join(REPO_ROOT, dir);
  if (existsSync(absDir)) {
    files.push(...collectFiles(absDir));
  }
}

if (!jsonMode && !baselineMode) {
  console.log(`[scan-code-dedup] 扫描 ${files.length} 个文件...`);
}

const duplicates = scanFiles(files);
const report = buildReport(files, duplicates);
const coverage = verifyCoverage(files, report);

report.coverage = coverage;

if (jsonMode || baselineMode) {
  const output = JSON.stringify(report, null, 2);
  if (baselineMode) {
    const baselinePath = join(REPO_ROOT, 'packages/brain/scripts/dedup-baseline.json');
    writeFileSync(baselinePath, output);
    console.log(`[scan-code-dedup] 基线已保存: ${baselinePath}`);
  } else {
    console.log(output);
  }
} else {
  console.log(`\n══════════════════════════════════════════`);
  console.log(` Brain 代码去重扫描报告`);
  console.log(`══════════════════════════════════════════`);
  console.log(` 扫描文件数:     ${report.total_files}`);
  console.log(` 规范化代码行:   ${report.total_normalized_lines}`);
  console.log(` 重复行数:       ${report.duplicate_lines}`);
  console.log(` 重复率:         ${report.duplication_pct}%`);
  console.log(` 重复块数:       ${report.duplicate_blocks}`);
  console.log(`──────────────────────────────────────────`);
  console.log(` 覆盖率验证:     ${coverage.passed ? '✅ 通过' : '❌ 失败'}`);
  if (!coverage.passed) {
    for (const issue of coverage.issues) {
      console.log(`   ⚠️  ${issue}`);
    }
  }
  console.log(`──────────────────────────────────────────`);
  if (report.top_duplicates.length > 0) {
    console.log(` Top 重复块:`);
    for (const d of report.top_duplicates.slice(0, 5)) {
      console.log(`   [×${d.count}] ${d.preview.substring(0, 60)}`);
      for (const loc of d.locations.slice(0, 3)) {
        console.log(`         → ${loc}`);
      }
    }
  }
  console.log(`──────────────────────────────────────────`);
  if (report.top_files_by_duplication.length > 0) {
    console.log(` 重复最多的文件:`);
    for (const f of report.top_files_by_duplication.slice(0, 5)) {
      console.log(`   ${f.dupLines} 行重复  ${f.file}`);
    }
  }
  console.log(`══════════════════════════════════════════\n`);
}
