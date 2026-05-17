import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

const SCRIPT = join(process.cwd(), 'skills', 'dev', 'scripts', 'parse-dev-args.sh');

describe('parse-dev-args.sh -- Phase 1 Round 2 后 AUTONOMOUS_MODE 永远 true', () => {
  it('默认输出 AUTONOMOUS_MODE=true（/dev 统一后唯一模式）', () => {
    const output = execSync(`bash "${SCRIPT}"`, { encoding: 'utf8' });
    expect(output).toContain('AUTONOMOUS_MODE=true');
  });

  it('--autonomous flag 已废弃，打 warn 但不改变行为', () => {
    const output = execSync(`bash "${SCRIPT}" --autonomous 2>&1`, { encoding: 'utf8' });
    expect(output).toContain('AUTONOMOUS_MODE=true');
    expect(output).toMatch(/deprecated|废弃/i);
  });

  it('--task-id 正常输出', () => {
    const output = execSync(
      `bash "${SCRIPT}" --task-id abc123`,
      { encoding: 'utf8', shell: '/bin/bash' }
    );
    expect(output).toContain('TASK_ID=abc123');
    expect(output).toContain('AUTONOMOUS_MODE=true');
  });

  it('Brain 不可达也不影响 AUTONOMOUS_MODE=true（不再查询 Brain payload）', () => {
    const output = execSync(
      `BRAIN_API_URL=http://localhost:59999 bash "${SCRIPT}" --task-id abc`,
      { encoding: 'utf8', shell: '/bin/bash' }
    );
    expect(output).toContain('AUTONOMOUS_MODE=true');
  });
});
