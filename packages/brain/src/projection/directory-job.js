import { runDirectoryProjection } from './directory-projector.js';

/** 与手工run共用目录锁；组织入口先成功，机器列才可投影。 */
export async function runDirectoryJob(pool, options = {}) {
  return runDirectoryProjection(pool, { ...options, beforeSource: async ({ client, token, config, notionReq }) => {
    const { syncDirectoryAreas } = await import('./directory-areas.js');
    const ownedPool = { query: client.query.bind(client), connect: async () => ({ query: client.query.bind(client), release() {} }) };
    await syncDirectoryAreas(ownedPool, { token, dbId: config.dbs.areas, notionReq,
      bindings: config.area_bindings || [], actor: 'directory-scheduler' });
  } });
}
