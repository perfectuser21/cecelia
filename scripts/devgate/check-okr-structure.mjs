#!/usr/bin/env node
/**
 * check-okr-structure.mjs
 *
 * CI DevGate 脚本：对活跃 OKR 数据运行 L0 结构验证。
 * 连接 PostgreSQL，运行 validateOkrStructure(pool, { scope: 'full' })。
 *
 * 用法：
 *   node scripts/devgate/check-okr-structure.mjs
 *
 * 环境变量：
 *   DATABASE_URL - PostgreSQL 连接字符串（默认 postgresql://localhost/cecelia）
 *
 * Exit codes:
 *   0 - 无 BLOCK issue
 *   1 - 存在 BLOCK issue
 *   2 - 连接失败或运行时错误
 */

import pg from 'pg';
import { validateOkrStructure } from '../../brain/src/validate-okr-structure.js';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  OKR Structure Check (L0)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

const dbUrl = process.env.DATABASE_URL || 'postgresql://localhost/cecelia';
const pool = new pg.Pool({ connectionString: dbUrl });

try {
  // 测试连接
  await pool.query('SELECT 1');

  const result = await validateOkrStructure(pool, { scope: 'full' });

  const blocks = result.issues.filter(i => i.level === 'BLOCK');
  const warnings = result.issues.filter(i => i.level === 'WARNING');
  const infos = result.issues.filter(i => i.level === 'INFO');

  if (blocks.length > 0) {
    console.log(`${RED}BLOCK issues (${blocks.length}):${RESET}`);
    for (const b of blocks) {
      console.log(`  ${RED}✗${RESET} [${b.entity}] ${b.rule}: ${b.message}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`${YELLOW}WARNING issues (${warnings.length}):${RESET}`);
    for (const w of warnings) {
      console.log(`  ${YELLOW}⚠${RESET} [${w.entity}] ${w.rule}: ${w.message}`);
    }
    console.log('');
  }

  if (infos.length > 0) {
    console.log(`INFO issues (${infos.length}):${RESET}`);
    for (const i of infos) {
      console.log(`  ℹ [${i.entity}] ${i.rule}: ${i.message}`);
    }
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (result.ok) {
    console.log(`${GREEN}✅ OKR 结构检查通过${RESET} (${warnings.length} warnings, ${infos.length} info)`);
    process.exit(0);
  } else {
    console.log(`${RED}❌ OKR 结构检查失败${RESET} (${blocks.length} blocks, ${warnings.length} warnings)`);
    process.exit(1);
  }
} catch (err) {
  console.error(`${RED}错误: ${err.message}${RESET}`);
  process.exit(2);
} finally {
  await pool.end();
}
