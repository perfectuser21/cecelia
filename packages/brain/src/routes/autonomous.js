import { existsSync, readdirSync, readFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Parse key-value lines from a .dev-mode file body.
 * Format: "key: value" per line, first line must be "dev".
 */
function parseDevMode(content) {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== 'dev') return null;
  const result = {};
  for (const line of lines.slice(1)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

/**
 * List worktree directories from `git worktree list --porcelain`.
 * Returns array of absolute paths (main repo + worktrees).
 */
async function listWorktreeDirs(repoRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain']);
    const dirs = [];
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        dirs.push(line.slice('worktree '.length).trim());
      }
    }
    return dirs;
  } catch {
    return [repoRoot];
  }
}

/**
 * Scan active autonomous sessions across main repo + worktrees.
 * Returns array of session objects sorted by started desc.
 */
export async function scanAutonomousSessions(projectRoot) {
  const dirs = await listWorktreeDirs(projectRoot);
  const sessions = [];
  const now = Date.now();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith('.dev-mode.cp-')) continue;
      const fullPath = `${dir}/${entry}`;
      let content;
      try {
        content = readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }
      const data = parseDevMode(content);
      if (!data) continue;
      // Skip finished sessions
      if (data.cleanup_done === 'true') continue;
      const started = data.started ? new Date(data.started).getTime() : 0;
      const elapsed_seconds = started > 0 ? Math.floor((now - started) / 1000) : 0;
      sessions.push({
        branch: data.branch || entry.replace('.dev-mode.', ''),
        autonomous_mode: data.autonomous_mode === 'true',
        harness_mode: data.harness_mode === 'true',
        owner_session: data.owner_session || '',
        started: data.started || '',
        steps: {
          step_0_worktree: data.step_0_worktree || 'pending',
          step_1_spec: data.step_1_spec || 'pending',
          step_2_code: data.step_2_code || 'pending',
          step_3_integrate: data.step_3_integrate || 'pending',
          step_4_ship: data.step_4_ship || 'pending',
        },
        task_card_path: data.task_card || '',
        worktree_path: dir,
        elapsed_seconds,
      });
    }
  }
  return sessions.sort((a, b) => {
    const aT = new Date(a.started || 0).getTime();
    const bT = new Date(b.started || 0).getTime();
    return bT - aT;
  });
}

/**
 * Express route handler factory.
 */
export default function createAutonomousRouter(projectRoot) {
  return async function handleAutonomousRoute(req, res) {
    try {
      const sessions = await scanAutonomousSessions(projectRoot);
      res.json({ sessions, count: sessions.length, scanned_at: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}
