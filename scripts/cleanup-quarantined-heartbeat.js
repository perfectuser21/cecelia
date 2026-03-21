#!/usr/bin/env node
/**
 * 清理 quarantined 状态的 dept_heartbeat 任务
 * 这些任务是之前路由错误导致的垃圾数据
 */

const { Pool } = require('pg');

async function cleanupQuarantinedHeartbeat() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia'
  });

  try {
    console.log('🔍 查找 quarantined 状态的 dept_heartbeat 任务...');

    const findResult = await pool.query(`
      SELECT id, title, dept, created_at
      FROM tasks
      WHERE task_type = 'dept_heartbeat' AND status = 'quarantined'
      ORDER BY created_at DESC
    `);

    if (findResult.rows.length === 0) {
      console.log('✅ 没有需要清理的 quarantined heartbeat 任务');
      return;
    }

    console.log(`📋 找到 ${findResult.rows.length} 个需要清理的任务:`);
    findResult.rows.forEach(row => {
      console.log(`   - ${row.id}: ${row.title} (部门: ${row.dept})`);
    });

    console.log('\n🗑️  开始清理...');
    const deleteResult = await pool.query(`
      DELETE FROM tasks
      WHERE task_type = 'dept_heartbeat' AND status = 'quarantined'
    `);

    console.log(`✅ 成功清理 ${deleteResult.rowCount} 个 quarantined heartbeat 任务`);

  } catch (error) {
    console.error('❌ 清理失败:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  cleanupQuarantinedHeartbeat();
}

module.exports = { cleanupQuarantinedHeartbeat };