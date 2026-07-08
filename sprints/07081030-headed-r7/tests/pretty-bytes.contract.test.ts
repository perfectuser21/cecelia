import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const testDir = fs.realpathSync(__dirname);
const workspaceRoot = path.resolve(testDir, '../../..');
const scriptPath = path.join(workspaceRoot, 'scripts/relay-demo/pretty-bytes.mjs');

function runPrettyBytes(input: number) {
  return spawnSync(process.execPath, [scriptPath, String(input)], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
}

describe('pretty-bytes CLI 合同 [BEHAVIOR]', () => {
  it('0 bytes returns a readable zero value', () => {
    const result = runPrettyBytes(0);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('0 B');
  });

  it('1024 bytes promotes to KB instead of staying in raw bytes', () => {
    const result = runPrettyBytes(1024);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('1 KB');
  });

  it('1 TB stays in TB instead of truncating or falling back to a lower unit', () => {
    const result = runPrettyBytes(1024 ** 4);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('1 TB');
  });
});
