import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export async function resolveReleaseArtifactVersions({ merge_sha: mergeSha }, {
  gitExecFile = (args) => execFileSync('git', args, { encoding: 'utf8' }),
} = {}) {
  const packageJson = JSON.parse(gitExecFile([
    'show',
    `${mergeSha}:packages/brain/package.json`,
  ]));
  const paths = gitExecFile([
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    `${mergeSha}^`,
    mergeSha,
  ]).trim().split('\n').filter(Boolean);
  const artifacts = [];
  if (paths.some((path) => path.startsWith('packages/brain/')
    || ['DEFINITION.md', '.brain-versions'].includes(path))) {
    artifacts.push({
      name: 'brain',
      version: packageJson.version,
      digest: sha256(gitExecFile(['ls-tree', '-r', mergeSha, 'packages/brain'])),
    });
  }
  if (paths.some((path) => path.startsWith('apps/'))) {
    artifacts.push({
      name: 'workspace',
      version: mergeSha.slice(0, 12),
      digest: sha256(gitExecFile(['ls-tree', '-r', mergeSha, 'apps'])),
    });
  }
  if (paths.some((path) => path.startsWith('packages/workflows/skills/'))) {
    artifacts.push({
      name: 'workflow-skills',
      version: mergeSha.slice(0, 12),
      digest: sha256(gitExecFile([
        'ls-tree',
        '-r',
        mergeSha,
        'packages/workflows/skills',
      ])),
    });
  }
  if (artifacts.length === 0) {
    throw new Error('release_non_deployable_change_blocked');
  }
  return artifacts;
}

export const __test__ = { sha256 };
