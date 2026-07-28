import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../..');
const production = [
  'deploy.yml',
  'promote-all-prod.yml',
  'brain-ci-deploy.yml',
  'promote-dashboard-prod.yml',
];

function workflow(name) {
  return readFileSync(resolve(root, '.github/workflows', name), 'utf8');
}

describe('legacy release surfaces fail closed', () => {
  it.each(production)('%s requires exact ReleaseRun production authority', (name) => {
    const source = workflow(name);
    expect(source).toMatch(/release_run_id:/);
    expect(source).toMatch(/merge_sha:/);
    expect(source).toMatch(/release_authorization:/);
    expect(source).toMatch(/release_run_id[^\n]*(RELEASE_RUN_ID|inputs\.release_run_id)/);
    expect(source).toMatch(/merge_sha[^\n]*(MERGE_SHA|inputs\.merge_sha)/);
    expect(source).toMatch(/release_authorization[^\n]*(RELEASE_AUTHORIZATION|inputs\.release_authorization)/);
    expect(source).toMatch(/group:\s*kernel-release/);
    expect(source).not.toMatch(/schedule:/);
    expect(source).not.toMatch(/push:/);
    expect(source).not.toMatch(/视为成功|production 部署不受阻断|Fast Lane/);
  });

  it('staging deploy requires the same exact ReleaseRun axes', () => {
    const source = workflow('auto-staging-deploy.yml');
    expect(source).toMatch(/release_run_id:/);
    expect(source).toMatch(/merge_sha:/);
    expect(source).toMatch(/release_authorization:/);
    expect(source).toMatch(/\\?"staging\\?":true/);
    expect(source).toMatch(/group:\s*kernel-release/);
    expect(source).not.toMatch(/push:/);
    expect(source).not.toMatch(/skipped_|视为通过|status idle/);
  });

  it('drift sentinel observes and escalates but never deploys', () => {
    const source = readFileSync(
      resolve(root, 'packages/brain/src/cron/drift-sentinel.js'),
      'utf8',
    );
    expect(source).not.toContain('scripts/brain-deploy.sh');
    expect(source).not.toMatch(/\bexec\(['"]bash .*deploy/);
    expect(source).toContain('blocked_unowned_release');
  });

  it('direct production scripts share an executable fail-closed guard', () => {
    const guard = resolve(root, 'scripts/lib/release-run-guard.sh');
    const result = spawnSync('bash', [guard, 'production'], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/ReleaseRun authority required/);

    const directProductionScripts = [
      'brain-deploy.sh',
      'promote-dashboard.sh',
      'post-merge-deploy.sh',
      'deploy.sh',
    ];
    for (const file of directProductionScripts) {
      const source = readFileSync(resolve(root, 'scripts', file), 'utf8');
      expect(source).toContain('release-run-guard.sh');
      expect(source).toContain('production');

      const denied = spawnSync('bash', [resolve(root, 'scripts', file)], {
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
      });
      expect(denied.status, `${file} must fail closed`).not.toBe(0);
      expect(`${denied.stdout}${denied.stderr}`).toMatch(/ReleaseRun authority required/);
    }
  });
});
