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

export function readGitBranch(repoRoot, exec = execFileSync) {
  try {
    const branch = exec(
      'git', ['-C', repoRoot, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' },
    ).trim();
    if (!branch) throw new Error('empty branch');
    return branch;
  } catch (error) {
    throw new Error(`无法读取 source branch (${repoRoot}): ${error.message}`);
  }
}
