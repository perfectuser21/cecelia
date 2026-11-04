import { vi, afterEach } from 'vitest';
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: mockQuery, connect: async () => ({
  query: async (sql, values) => /^(BEGIN|COMMIT|ROLLBACK|LOCK TABLE)/.test(sql)
    ? { rows: [] } : sql.includes('AS organization FROM (SELECT * FROM value_streams')
      ? { rows: [{ organization: { gaps: [] } }] } : mockQuery(sql, values),
  release() {},
}) } }));
export { mockQuery };
const fixtureServers = new Set();
afterEach(async () => {
  try {
    await Promise.all([...fixtureServers].map(server => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    })));
  } finally { fixtureServers.clear(); }
});
export async function bindFixture(app) {
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  fixtureServers.add(server);
  return server;
}
