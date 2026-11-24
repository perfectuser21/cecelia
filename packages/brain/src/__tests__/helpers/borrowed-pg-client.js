/** 测试已连接并管理事务的真实 PG 会话：只借用 query，不让 Pool API 重新 connect 或提交外层事务。 */
export function borrowedPgClient(client) {
  return { query: (...args) => client.query(...args) };
}
