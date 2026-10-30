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
