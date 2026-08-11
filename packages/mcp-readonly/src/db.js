import pg from 'pg';
const { Pool } = pg;

export function createReadonlyPool(connectionString, { max = 5 } = {}) {
  return new Pool({ connectionString, max });
}

export async function query(pool, sql, params = [], { timeoutMs = 5000 } = {}) {
  // SET 语句不支持 $1 占位符参数化绑定，timeoutMs 最终必须以字符串拼接的形式
  // 进入 SQL 文本。又因为下面是单字符串形式的 client.query() 调用（走 PG
  // simple-query 协议，允许分号分隔多条语句），拼接前如果不严格校验成受控整数，
  // 调用方传入的 timeoutMs 就等于拿到了任意 SQL 执行权限。这里用"先验证成安全
  // 类型，验证不过直接拒绝"而不是"尝试转义/清洗"，因为这是唯一能排除掉所有
  // 分号注入变体的做法。
  const safeTimeout = Number(timeoutMs);
  if (!Number.isInteger(safeTimeout) || safeTimeout < 0) {
    throw new Error('invalid timeoutMs');
  }

  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${safeTimeout}`);
    return await client.query(sql, params);
  } catch (err) {
    if (err.code === '57014') {
      throw new Error('timeout');
    }
    throw err;
  } finally {
    // statement_timeout 是连接（session）级别设置，client.release() 并不会重置它。
    // query() 包装函数本身每次都会先 SET 再 RESET，所以只要调用方都走这个函数，
    // 不会有实际泄漏；但 pool 是这个模块导出的共享对象，如果有代码绕开 query()
    // 直接 pool.connect() / client.query() 手动设置 statement_timeout 又不清理，
    // 之后借用同一条连接的调用者会真实继承那个残留值。RESET 是为了让这份保证
    // 在“绕开包装函数”的场景下依然成立，不是防自身重入。
    try {
      await client.query('RESET statement_timeout');
    } catch {
      // 连接可能因为前面的错误已经不可用，reset 失败不应掩盖原始错误，静默即可
    }
    client.release();
  }
}
