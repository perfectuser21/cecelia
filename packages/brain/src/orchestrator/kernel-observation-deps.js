import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readGitArtifact, listGitArtifacts } from './git-artifact-reader.js';

/** 历史观察只装配读能力，不注册执行目录、凭据、派发器或后台循环。 */
export async function buildObservationDeps(overrides = {}) {
  const pool = overrides.pool ?? (await import('../db.js')).default;
  overrides.onPool?.(pool);
  const repoRoot = (overrides.env ?? process.env).REPO_ROOT || process.cwd();
  return {
    pool,
    execCmd: overrides.execCmd ?? (cmd => execSync(cmd, {
      encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
    })),
    fileExists: overrides.fileExists ?? existsSync,
    readFile: overrides.readFile ?? (file => readFileSync(file, 'utf-8')),
    readGitFile: overrides.readGitFile ?? ((sha, file, options = {}) => readGitArtifact(sha, file, {
      cwd: repoRoot, repo: options.repo ?? null,
    })),
    listGitFiles: overrides.listGitFiles ?? ((sha, prefix, options = {}) => listGitArtifacts(sha, prefix, {
      cwd: repoRoot, repo: options.repo ?? null,
    })),
  };
}
