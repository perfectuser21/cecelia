/**
 * smoke fixture：模拟一个未授权外部脚本，尝试调用 updateSelfModel。
 * 应当被 SelfModelWriteDeniedError 拒绝。
 * 命中 → exit 0；意外通过或抛非预期错误 → exit 1。
 *
 * 不连真数据库——用 inline mock pool，因为锁机制在写入前的 caller 检查就该 fail，
 * 根本不会走到 SQL 执行。
 */

import { updateSelfModel, SelfModelWriteDeniedError } from '../../src/self-model.js';

const mockPool = {
  query: async (sql) => {
    if (/SELECT/i.test(sql)) {
      return { rows: [{ content: 'mock-seed', created_at: new Date() }] };
    }
    return { rows: [] };
  },
};

try {
  await updateSelfModel('未授权写入测试', mockPool);
  console.error('❌ 锁未生效：updateSelfModel 居然成功了');
  process.exit(1);
} catch (err) {
  if (err instanceof SelfModelWriteDeniedError) {
    console.log('  锁生效：', err.message);
    process.exit(0);
  }
  console.error('❌ 抛出了非预期错误：', err && err.constructor && err.constructor.name, err.message);
  process.exit(1);
}
