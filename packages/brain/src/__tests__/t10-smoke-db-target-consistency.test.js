/**
 * t10-smoke-db-target-consistency.test.js
 *
 * 回归护栏：packages/brain/scripts/smoke/t10-capture-atom-routing-smoke.sh 的
 * 写入路径（node 子进程，经 auto-learning.js -> db.js -> db-config.js）和
 * 校验路径（psql）必须从同一个变量来源解析数据库目标。
 *
 * 背景 bug（真实发生过一次生产库脏数据事故，evaluator 已清理）：
 *   脚本用 `DB="${DATABASE_URL:-postgresql://.../cecelia_test}"` 只给 psql 校验用，
 *   但真正写入数据的 node 子进程走 `packages/brain/src/db-config.js`，该文件根本不读
 *   `DATABASE_URL`，只读 `DB_NAME`（未显式设置时默认 fallback 到生产库 `cecelia`，
 *   除非 NODE_ENV=test/VITEST=true）。两条路径默认目标不同源，导致 smoke 脚本
 *   默认调用（不传任何 env）就会把测试数据写进生产库 cecelia，而 psql 校验却查
 *   cecelia_test，形成"验证通过"但生产库已被污染的假阳性。
 *
 * 本测试用 source-code inspection（读取脚本源码文本）断言：
 *   1. 脚本不再包含 `DATABASE_URL`（db-config.js 完全忽略这个变量名，出现即是根因复发）。
 *   2. 脚本必须显式声明 DB_NAME 默认值为 cecelia_test（对齐 db-config.js 真实读取的变量名）。
 *   3. 调用 node 子进程（写入路径）的那个命令，必须显式传递 DB_NAME= 环境变量，
 *      确保写入路径与校验路径（psql 用 $DB，由同一个 DB_NAME 拼出）解析同一个数据库目标。
 *   4. 脚本必须对 DB_NAME=cecelia（生产库）做显式拒绝护栏，防止未来被误用于生产库。
 *
 * 永久保留在 CI，不得删除（CLAUDE.md bug fix 铁律）。
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(
  __dirname,
  '../../scripts/smoke/t10-capture-atom-routing-smoke.sh'
);

function readScript() {
  return readFileSync(SCRIPT_PATH, 'utf8');
}

describe('T10 smoke 脚本写入路径/校验路径数据库目标一致性 [BEHAVIOR]', () => {
  it('脚本不应再包含 DATABASE_URL（db-config.js 完全忽略该变量名，写入侧永远不会读到它）', () => {
    const src = readScript();
    expect(src.includes('DATABASE_URL')).toBe(false);
  });

  it('脚本必须显式声明 DB_NAME 默认值为 cecelia_test（对齐 db-config.js 真实读取的变量名）', () => {
    const src = readScript();
    expect(src).toMatch(/DB_NAME="\$\{DB_NAME:-cecelia_test\}"/);
  });

  it('调用 node 子进程（真正写入数据的路径）的命令必须显式传递 DB_NAME= 环境变量，确保写入路径与 psql 校验路径解析同一个数据库目标', () => {
    const src = readScript();
    const nodeInvocationMatch = src.match(
      /RESULT=\$\([\s\S]*?node --input-type=module[\s\S]*?\n"\)/
    );
    expect(nodeInvocationMatch, 'smoke 脚本应包含 node --input-type=module 子进程写入调用').not.toBeNull();

    const invocationBlock = nodeInvocationMatch[0];
    expect(invocationBlock).toMatch(/DB_NAME="\$DB_NAME"/);
  });

  it('脚本必须显式拒绝 DB_NAME=cecelia（生产库），防止未来被误用于生产库', () => {
    const src = readScript();
    // 拒绝逻辑必须真的会 exit，而不仅仅是注释提及
    expect(src).toMatch(/if\s*\[\s*"\$DB_NAME"\s*=\s*"cecelia"\s*\][\s\S]{0,200}exit\s+1/);
  });
});
