import { expect, it } from 'vitest';
import { parse } from 'acorn';
import { collectBasicCiSources, collectDeepCiSources } from '../existing-ops-stage-source.js';
import { readFixedExistingOpsGitFixture } from './helpers/fixed-existing-ops-git-fixture.js';

const previous = readFixedExistingOpsGitFixture('13d576c6a6223ff305e4734b37d46600e02fe48b');
const nightly = '.github/workflows/nightly-regression.yml';
const before = previous.read(nightly);
const binding = '          SNAPSHOT_POSTGRES_CONTAINER: ${{ job.services.postgres.id }}\n';
const candidate = before.replace('      - name: Run full database regressions\n        env:\n', '$&' + binding);

async function collect(workflow, content, deep, fixture = previous) {
  const read = async path => path === workflow ? content : fixture.read(path);
  const inputs = { read, paths: fixture.paths, revision: fixture.revision, relations: [],
    parse: text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' }) };
  if (deep) await collectDeepCiSources(inputs);
  else await collectBasicCiSources({ ...inputs, ci: await read('.github/workflows/ci.yml') });
  return inputs.relations;
}

it.each([false, true])('数据库快照客户端只接纳精确旧版与现役 runner service 绑定，deep=%s', async deep => {
  expect(candidate).not.toBe(before);
  for (const text of [before, candidate]) expect((await collect(nightly, text, deep)).length).toBeGreaterThan(0);
  await expect(collect(nightly, candidate.replace('job.services.postgres.id', 'env.PRODUCTION_CONTAINER'), deep)).rejects.toThrow();
  await expect(collect(nightly, candidate + '\n', deep)).rejects.toThrow();
  const older = readFixedExistingOpsGitFixture('85f24b00af99063cf27919cdcf79675d6d33e6a3');
  await expect(collect(nightly, candidate, deep, older)).rejects.toThrow();
});
