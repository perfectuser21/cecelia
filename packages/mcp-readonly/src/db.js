import pg from 'pg';
const { Pool } = pg;

export function createReadonlyPool(connectionString, { max = 5 } = {}) {
  return new Pool({ connectionString, max });
}

export async function query(pool, sql, params = [], { timeoutMs = 5000 } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    return await client.query(sql, params);
  } catch (err) {
    if (err.code === '57014') {
      throw new Error('timeout');
    }
    throw err;
  } finally {
    // statement_timeout 是连接（session）级别设置，client.release() 并不会重置它。
    // 如果不在这里 RESET，下一个借用这个 client 的调用者会静默继承上一次设置的
    // timeoutMs——轻则超时判定不准，重则一个短超时把后面本该正常完成的查询也打断。
    // pool 里连接会被复用，这不是理论风险，是必现的真实故障，所以直接修掉。
    try {
      await client.query('RESET statement_timeout');
    } catch {
      // 连接可能因为前面的错误已经不可用，reset 失败不应掩盖原始错误，静默即可
    }
    client.release();
  }
}
