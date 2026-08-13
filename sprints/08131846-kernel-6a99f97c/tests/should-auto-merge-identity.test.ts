import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TDD Red（RED-A）：should-auto-merge.sh 必须凭不可伪造机器身份（harness label）判定，
// 而非靠 `feat(harness):` 标题前缀猜测。事故 PR #4870 是 `fix(harness):`，被漏判成 MERGE。
// 现状脚本只识别 `^feat(harness):` 标题、忽略 labels → 本用例现在应为 RED。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../.github/workflows/scripts/should-auto-merge.sh');

function decide(branch: string, title: string, labels: string): string {
  return execFileSync('bash', [SCRIPT, branch, title, labels], { encoding: 'utf8' }).trim();
}

describe('should-auto-merge 机器身份判据 [BEHAVIOR]', () => {
  it('fix(harness) + harness label → SKIP（任意 change_kind 凭机器身份跳过）', () => {
    const out = decide('cp-08131846-6a99f97c', 'fix(harness): kernel 合并硬闸', 'harness');
    expect(out).toMatch(/^SKIP/);
  });

  it('普通 /dev fix(brain) 无 label → MERGE（不误伤 /dev 通道）', () => {
    const out = decide('cp-08131846-abc', 'fix(brain): 修复调度队头阻塞', '');
    expect(out).toBe('MERGE');
  });

  it('fix(harness) 但无 harness label → MERGE（证明不再靠标题字符串猜）', () => {
    const out = decide('cp-08131846-def', 'fix(harness): 无身份标记', '');
    expect(out).toBe('MERGE');
  });
});
