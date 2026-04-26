import { Router } from 'express';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function probeGitSha() {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: path.resolve(__dirname, '../..'),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    );
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const BUILT_AT = new Date().toISOString();
const GIT_SHA = probeGitSha();
const PACKAGE_VERSION = readPackageVersion();

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    git_sha: GIT_SHA,
    package_version: PACKAGE_VERSION,
    built_at: BUILT_AT,
  });
});

export default router;
