import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(source).toContain('"release_run_id"');
    expect(source).toContain('"merge_sha"');
    expect(source).toContain('"release_authorization"');
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
    expect(source).toContain('"staging":true');
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
});
