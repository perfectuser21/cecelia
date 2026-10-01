import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveCanonicalRoutingEvidence } from '../work-routing-store.js';
import * as fixtures from './fixtures/task-intake-db.js';

const repository = fileURLToPath(new URL('../../../..', import.meta.url));
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

describe('交办Git证据夹具', () => {
  it.each(['缺少 origin/main', 'detached HEAD 且没有任何 ref'])('%s：独立Git事实提供真实HEAD且不改源refs', async (layout) => {
    const directory = mkdtempSync(join(tmpdir(), 'intake-source-without-main-'));
    const source = join(directory, 'source');
    let fixture;
    try {
      git(repository, ['clone', '--depth', '1', '--no-checkout', pathToFileURL(repository).href, source]);
      expect(git(source, ['rev-parse', '--is-shallow-repository'])).toBe('true');
      git(source, ['update-ref', '-d', 'refs/remotes/origin/main']);
      const head = git(source, ['rev-parse', 'HEAD']);
      if (layout === 'detached HEAD 且没有任何 ref') {
        git(source, ['update-ref', '--no-deref', 'HEAD', head]);
        const refs = git(source, ['for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean);
        for (const ref of refs) git(source, ['update-ref', '-d', ref]);
        expect(git(source, ['for-each-ref', '--format=%(refname)'])).toBe('');
      }
      const originalRefs = git(source, ['show-ref']);
      const request = { source: 'api', source_id: 'fixture', repo: 'intake-test-repo' };
      await expect(resolveCanonicalRoutingEvidence(request, [{ repo: request.repo, path: source }]))
        .rejects.toMatchObject({ code: 'routing_evidence_unavailable' });

      expect(fixtures.createIntakeRepositoryFixture, '验真需自带独立真实Git证据').toBeTypeOf('function');
      fixture = await fixtures.createIntakeRepositoryFixture(source);
      expect(fixture.path).not.toBe(source);
      expect(await resolveCanonicalRoutingEvidence(request, [{ repo: request.repo, path: fixture.path }]))
        .toMatchObject({ base_sha: head });
      expect(git(source, ['show-ref'])).toBe(originalRefs);
      await fixture.close();
      expect(existsSync(fixture.path)).toBe(false);
    } finally {
      await fixture?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
