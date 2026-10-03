'use strict';
// 仅当前不可达性证据条件成立时豁免精确advisory；不是漏洞修复或包级许可。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const URL = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const EXPIRY = '2026-10-10T00:00:00Z';
const SERVER = 'apps/api/src/dashboard/server.ts';
const INSTALLED = [
  { name: 'http-proxy-middleware', version: '3.0.7' },
  { name: 'micromatch', version: '4.0.8' },
  { name: 'braces', version: '3.0.3' },
];
const GOVERNANCE = new Set(['scripts/ci/runtime-advisory-filter.cjs',
  'scripts/ci/runtime-advisory-conditions.json', 'scripts/ci/dep-audit-runtime-high.sh']);
// 两个既存文档/skill指针只冻结link本身；绝不跟读或承诺外部target安全。
const KNOWN_LINKS = {
  'packages/brain/sprints': '../../sprints',
  'packages/workflows/.claude/skills/posts': '/home/xx/dev/zenithjoy-creator/.claude/skills/posts',
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// 保守清单：workspace及现有运行入口目录全部非测试/文档文件（含非JS资产/配置）。
// root manifest/.gitignore/运行入口配置也冻结；新增源通过git census纳入，绝不自动刷新基准。
function sourceCensus(root) {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const index = new Map();
  const indexed = execFileSync('git', ['ls-files', '-s', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  for (const record of indexed.split('\0').filter(Boolean)) {
    const match = /^([0-9]{6}) ([a-f0-9]+) ([0-3])\t(.*)$/.exec(record);
    if (!match || match[3] !== '0') throw new Error('invalid or unmerged git index');
    index.set(match[4], { mode: match[1], object: match[2] });
  }
  const files = [...new Set(output.split('\0').filter(Boolean))].sort().filter(file => {
    if (GOVERNANCE.has(file)) return false;
    if (/(^|\/)(__tests__|tests|test|fixtures|docs)(\/|$)/.test(file)
        || /\.(test|spec)\.[^/]+$/.test(file) || /\.(md|mdx)$/.test(file)) return false;
    if (/^(apps|packages|scripts|frontend|config|ci|hooks|docker|database|templates|playground)\//.test(file)) return true;
    if (/\.(js|cjs|mjs|ts|tsx|jsx|sh|bash|zsh|py|rb|go|rs|java|kt)$/.test(file)) return true;
    return !file.includes('/') && (file === '.gitignore' || file === 'package.json'
      || /\.(js|cjs|mjs|ts|json|yaml|yml|sh|py)$/.test(file));
  });
  const lines = files.map(file => {
    const full = path.join(root, file);
    const stat = fs.lstatSync(full), tracked = index.get(file);
    if (stat.isSymbolicLink()) {
      const literal = fs.readlinkSync(full);
      if (KNOWN_LINKS[file] !== literal || tracked?.mode !== '120000'
          || execFileSync('git', ['cat-file', 'blob', tracked.object], { cwd: root, encoding: 'utf8' }) !== literal) {
        throw new Error('unknown or changed runtime symlink');
      }
      return `L\0${file}\0${literal}\n`;
    }
    if (!stat.isFile() || tracked?.mode === '120000') throw new Error('runtime source type drift');
    return `F\0${file}\0${hash(fs.readFileSync(full))}\n`;
  });
  return { count: files.length, sha256: hash(lines.join('')) };
}

function resolveLockNode(packages, parent, name) {
  let directory = parent;
  while (true) {
    const candidate = (directory ? directory + '/' : '') + 'node_modules/' + name;
    if (packages[candidate]) return candidate;
    if (!directory) return null;
    directory = path.posix.dirname(directory);
    if (directory === '.') directory = '';
  }
}
// 从受影响节点反向遍历所有production incoming edges，新增消费链也改变闭包。
function runtimeClosure(lock) {
  if (!object(lock) || ![2, 3].includes(lock.lockfileVersion) || !object(lock.packages)) {
    throw new Error('invalid root lock schema');
  }
  const packages = lock.packages, edges = [];
  for (const [parent, entry] of Object.entries(packages)) {
    if (!object(entry)) throw new Error('invalid package node');
    if (entry.dev === true || entry.link === true) continue;
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      if (entry[field] !== undefined && !object(entry[field])) throw new Error('invalid dependency schema');
      for (const [name, range] of Object.entries(entry[field] || {})) {
        const target = resolveLockNode(packages, parent, name);
        if (target && packages[target].dev !== true) edges.push({ parent, field, name, range, target });
      }
    }
  }
  if (!packages['node_modules/braces'] || packages['node_modules/braces'].dev === true) {
    throw new Error('missing production braces node');
  }
  const members = new Set(['node_modules/braces']), selected = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) if (members.has(edge.target) && !selected.includes(edge)) {
      selected.push(edge);
      if (!members.has(edge.parent)) { members.add(edge.parent); changed = true; }
    }
  }
  const nodes = [...members].sort().map(node => ({ node, version: packages[node].version,
    resolved: packages[node].resolved || null, integrity: packages[node].integrity || null }));
  selected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  return { count: nodes.length, sha256: hash(JSON.stringify({ nodes, edges: selected })), nodes, edges: selected };
}

function installedChain(root) {
  let importer = createRequire(path.join(root, SERVER));
  return INSTALLED.map(expected => {
    const file = importer.resolve(expected.name + '/package.json');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (entry.name !== expected.name) throw new Error('installed package identity mismatch');
    importer = createRequire(file);
    return { name: entry.name, version: entry.version };
  });
}
function verifyCondition(root, profile, now = new Date()) {
  try {
    if (!object(profile) || profile.schemaVersion !== 1 || profile.advisory !== URL
        || profile.expiresAt !== EXPIRY || !Number.isFinite(now.getTime())
        || now.getTime() >= Date.parse(EXPIRY)
        || JSON.stringify(profile.installed) !== JSON.stringify(INSTALLED)
        || JSON.stringify(profile.knownLinks) !== JSON.stringify(KNOWN_LINKS)
        || !object(profile.source) || !Number.isInteger(profile.source.count) || profile.source.count <= 0
        || !isHash(profile.source.sha256) || !object(profile.closure)
        || !Number.isInteger(profile.closure.count) || profile.closure.count <= 0
        || !isHash(profile.closure.sha256) || !isHash(profile.serverSha256)) {
      throw new Error('invalid or expired condition profile');
    }
    if (hash(fs.readFileSync(path.join(root, SERVER))) !== profile.serverSha256) throw new Error('proxy source drift');
    const source = sourceCensus(root), closure = runtimeClosure(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))));
    if (source.sha256 !== profile.source.sha256 || source.count !== profile.source.count) throw new Error('runtime source census drift');
    if (closure.sha256 !== profile.closure.sha256 || closure.count !== profile.closure.count) throw new Error('runtime dependency closure drift');
    if (JSON.stringify(installedChain(root)) !== JSON.stringify(INSTALLED)) throw new Error('installed dependency identity drift');
    return { ok: true, source, closure: { count: closure.count, sha256: closure.sha256 } };
  } catch (error) { return { ok: false, reason: error.message }; }
}

function filterAudit(data, legacyAllow = new Set(), condition = { ok: false }) {
  if (!object(data) || data.auditReportVersion !== 2 || !object(data.vulnerabilities) || data.error) {
    return [{ name: 'audit-schema', severity: 'high', title: '缺失或无效audit schema' }];
  }
  const bad = [];
  for (const [name, vulnerability] of Object.entries(data.vulnerabilities)) {
    if (!object(vulnerability) || vulnerability.name !== name || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
      bad.push({ name, severity: 'high', title: '无效vulnerability schema' }); continue;
    }
    for (const via of vulnerability.via) {
      if (typeof via === 'string' && via) continue; // 纯继承仍交实际持有者；不重复拦链。
      if (!object(via) || !['info', 'low', 'moderate', 'high', 'critical'].includes(via.severity)
          || typeof via.url !== 'string' || !via.url) {
        bad.push({ name, severity: 'high', title: '无效advisory schema' }); continue;
      }
      if (!['high', 'critical'].includes(via.severity) || (name !== 'braces' && legacyAllow.has(name))) continue;
      const exact = name === 'braces' && via.name === 'braces' && via.dependency === 'braces'
        && via.url === URL && via.severity === 'high' && via.range === '<=3.0.3'
        && Array.isArray(vulnerability.nodes)
        && vulnerability.nodes.length === 1 && vulnerability.nodes[0] === 'node_modules/braces';
      if (exact && condition.ok === true) continue;
      bad.push({ name, severity: via.severity, title: via.title || via.url });
    }
  }
  return bad;
}

module.exports = { sourceCensus, runtimeClosure, installedChain, verifyCondition, filterAudit };
if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  try {
    const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-advisory-conditions.json')));
    const condition = verifyCondition(root, profile);
    if (process.argv.length === 3 && process.argv[2] === '--verify-condition') {
      console.log(JSON.stringify(condition)); process.exitCode = condition.ok ? 0 : 1;
    } else if (process.argv.length !== 2) {
      throw new Error('unsupported filter arguments');
    } else {
      if (!condition.ok) throw new Error('advisory condition unavailable: ' + condition.reason);
      const data = JSON.parse(fs.readFileSync(0, 'utf8'));
      const bad = filterAudit(data, new Set((process.env.ALLOW || '').split(/\s+/).filter(Boolean)), condition);
      for (const entry of bad) console.log(`${entry.name}\t${entry.severity}\t${String(entry.title).replace(/[\t\r\n]/g, ' ').slice(0, 100)}`);
    }
  } catch (error) { console.error('[runtime-advisory-filter] ' + error.message); process.exitCode = 1; }
}
