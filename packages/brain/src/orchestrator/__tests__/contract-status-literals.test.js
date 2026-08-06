/**
 * 合同 status 字面值守卫(r43 实证:#4664 reopen handler 写 status='revision',
 * 但 initiative_contracts_status_check 只允许 draft/approved/superseded——
 * 潜伏到首次实弹 reopen 才炸,run 直接 kernel_process_fatal)。
 *
 * 扫 orchestrator 源码里所有 UPDATE initiative_contracts ... status = '<literal>'
 * 的字面值,断言都在 schema 约束合法集内。schema 若扩枚举,此处同步改。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED = new Set(['draft', 'approved', 'superseded']);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('initiative_contracts status 字面值 ⊆ 表约束合法集', () => {
  it('orchestrator 源码内所有合同 status 写入值合法', () => {
    const offenders = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const src = readFileSync(path.join(dir, f), 'utf8');
      const re = /UPDATE\s+initiative_contracts\s+SET\s+status\s*=\s*'([a-z_]+)'/gi;
      let m;
      while ((m = re.exec(src)) !== null) {
        if (!ALLOWED.has(m[1])) offenders.push(`${f}: status='${m[1]}'`);
      }
    }
    expect(offenders, `非法合同 status 字面值(合法集: ${[...ALLOWED].join('/')})`).toEqual([]);
  });
});
