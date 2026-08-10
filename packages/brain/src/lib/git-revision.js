import { execFileSync } from 'node:child_process';

export function readGitRevision(repoRoot, exec = execFileSync) {
  try {
    const revision = exec(
      'git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' },
    ).trim();
    if (!revision) throw new Error('empty revision');
    return revision;
  } catch (error) {
    throw new Error(`无法读取 source revision (${repoRoot}): ${error.message}`);
  }
}
