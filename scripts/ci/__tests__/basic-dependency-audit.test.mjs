import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const good = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };

for (const name of ['dep-audit-critical.sh', 'dep-audit-runtime-high.sh']) {
  function run(body, status = 0) {
    const directory = mkdtempSync(join(tmpdir(), 'ci-audit-evidence-'));
    try {
      const fixture = join(directory, 'audit.json');
      writeFileSync(fixture, typeof body === 'string' ? body : JSON.stringify(body));
      writeFileSync(join(directory, 'npm'), '#!/bin/sh\ncat "$AUDIT_FIXTURE"\nexit "$AUDIT_EXIT"\n', { mode: 0o755 });
      return spawnSync('bash', [new URL(`../${name}`, import.meta.url).pathname], {
        encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, AUDIT_FIXTURE: fixture, AUDIT_EXIT: String(status) },
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  test(`${name}：完整无漏洞报告通过`, () => {
    const result = run(good);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
  for (const body of ['', '{', { error: { code: 'E503' } }, {}, { ...good, vulnerabilities: [] },
    { ...good, metadata: { vulnerabilities: { total: 1 } } },
    { ...good, metadata: { vulnerabilities: { total: 1 } }, vulnerabilities: { bad: { severity: 'critical', via: [{}] } } },
    { ...good, metadata: { vulnerabilities: { total: 1 } }, vulnerabilities: { bad: { severity: 'critical', via: ['missing'] } } },
  ]) {
    test(`${name}：缺失或异常报告拒绝`, () => {
      const result = run(body);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
    });
  }
  test(`${name}：审计工具异常退出不能冒充有效报告`, () => {
    assert.notEqual(run(good, 2).status, 0);
    assert.notEqual(run(good, 1).status, 0);
  });
  test(`${name}：真实新 critical 漏洞仍被拒绝`, () => {
    const report = {
      ...good, metadata: { vulnerabilities: { total: 1 } },
      vulnerabilities: { bad: { severity: 'critical', via: [{ severity: 'critical', url: 'https://github.com/advisories/GHSA-new-ci-regression', title: 'fixture' }] } },
    };
    assert.notEqual(run(report, 1).status, 0);
  });
}

// 生产回归：包级豁免不能自动批准同一包后来出现的其它高危公告。
function runRuntimeAdvisories(advisories, packageName = '@opentelemetry/propagator-jaeger') {
  const directory = mkdtempSync(join(tmpdir(), 'ci-audit-advisory-scope-'));
  try {
    const report = { auditReportVersion: 2, metadata: { vulnerabilities: { total: 1 } },
      vulnerabilities: { [packageName]: { severity: 'high', via: advisories } } };
    const fixture = join(directory, 'audit.json');
    writeFileSync(fixture, JSON.stringify(report));
    writeFileSync(join(directory, 'npm'), '#!/bin/sh\ncat "$AUDIT_FIXTURE"\nexit 1\n', { mode: 0o755 });
    return spawnSync('bash', [new URL('../dep-audit-runtime-high.sh', import.meta.url).pathname], {
      encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, AUDIT_FIXTURE: fixture },
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
const approvedJaeger = { severity: 'high', title: '现有Jaeger传播器DoS公告', url: 'https://github.com/advisories/GHSA-45rx-2jwx-cxfr' };
const unknownJaeger = { severity: 'high', title: '隔离合成未知公告', url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx' };
for (const [packageName, ghsa] of [
  ['@opentelemetry/propagator-jaeger', 'GHSA-45rx-2jwx-cxfr'],
]) {
  test(`runtime原批准精确公告仍通过：${packageName}`, () => {
    const result = runRuntimeAdvisories([{ ...approvedJaeger, url: `https://github.com/advisories/${ghsa}` }], packageName);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
for (const [name, advisories, packageName] of [
  ['同包未知high', [unknownJaeger], '@opentelemetry/propagator-jaeger'],
  ['已批与未知混合high', [approvedJaeger, unknownJaeger], '@opentelemetry/propagator-jaeger'],
  ['其它包借用Jaeger公告', [approvedJaeger], 'uuid'],
  ['公告来源主机不符', [{ ...approvedJaeger, url: 'https://example.invalid/advisories/GHSA-45rx-2jwx-cxfr' }], '@opentelemetry/propagator-jaeger'],
  ['公告ID缺失', [{ ...approvedJaeger, url: 'https://github.com/advisories/' }], '@opentelemetry/propagator-jaeger'],
  ['公告ID畸形', [{ ...approvedJaeger, url: 'https://github.com/advisories/GHSA-invalid' }], '@opentelemetry/propagator-jaeger'],
]) {
  test(`runtime拒绝${name}`, () => {
    const result = runRuntimeAdvisories(advisories, packageName);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  });
}

for (const [packageName, ghsa] of [
  ['uuid', 'GHSA-w5hq-g745-h8pq'],
  ['react-router', 'GHSA-qwww-vcr4-c8h2'],
  ['braces', 'GHSA-vfj7-8cjw-p6xm'],
]) {
  test(`runtime不预留已退休历史豁免：${packageName}`, () => {
    const result = runRuntimeAdvisories([{ ...approvedJaeger, url: `https://github.com/advisories/${ghsa}` }], packageName);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  });
}
