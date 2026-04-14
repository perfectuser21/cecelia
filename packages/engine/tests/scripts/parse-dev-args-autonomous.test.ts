import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

const SCRIPT = join(process.cwd(), 'skills', 'dev', 'scripts', 'parse-dev-args.sh');

describe('parse-dev-args.sh -- --autonomous 参数', () => {
  it('传入 --autonomous 时输出 AUTONOMOUS_MODE=true', () => {
    const output = execSync(`bash "${SCRIPT}" --autonomous`, { encoding: 'utf8' });
    expect(output).toContain('AUTONOMOUS_MODE=true');
  });

  it('不传 --autonomous 且无 --task-id 时输出 AUTONOMOUS_MODE=false', () => {
    const output = execSync(`bash "${SCRIPT}"`, { encoding: 'utf8' });
    expect(output).toContain('AUTONOMOUS_MODE=false');
  });

  it('--task-id 但 Brain 不可达时 AUTONOMOUS_MODE=false（默认）', () => {
    const output = execSync(
      `BRAIN_API_URL=http://localhost:59999 bash "${SCRIPT}" --task-id nonexistent`,
      { encoding: 'utf8', shell: '/bin/bash' }
    );
    expect(output).toMatch(/AUTONOMOUS_MODE=/);
    // Brain 不可达时不应崩溃
  });

  it('--autonomous 和 --task-id 同时给时 AUTONOMOUS_MODE=true（--autonomous 优先）', () => {
    const output = execSync(
      `BRAIN_API_URL=http://localhost:59999 bash "${SCRIPT}" --autonomous --task-id abc`,
      { encoding: 'utf8', shell: '/bin/bash' }
    );
    expect(output).toContain('AUTONOMOUS_MODE=true');
  });
});
