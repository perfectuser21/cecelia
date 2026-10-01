/** 从创建起跟踪公共 connect/remove；查询出错移出池的 socket 也必须退出。 */
import { clearTimeout, setTimeout } from 'node:timers';

const tracked = new WeakMap();
export function trackPgPool(pool) {
  const clients = new Set();
  const connect = (client) => clients.add(client);
  const remove = (client) => clients.delete(client);
  pool.on('connect', connect);
  pool.on('remove', remove);
  tracked.set(pool, { clients, connect, remove });
  return pool;
}

export async function closePgPool(pool) {
  const state = tracked.get(pool);
  if (!state) throw new Error('PG 测试池必须在首次连接前登记跟踪');
  let onRemove;
  let timer;
  const socketsClosed = new Promise((resolve, reject) => {
    onRemove = () => { if (!state.clients.size) resolve(); };
    pool.on('remove', onRemove);
    timer = setTimeout(() => reject(new Error('PG 测试连接退出超时')), 5000);
    if (!state.clients.size) resolve();
  });
  try {
    await Promise.all([pool.end(), socketsClosed]);
  } finally {
    clearTimeout(timer);
    pool.removeListener('remove', onRemove);
    pool.removeListener('connect', state.connect);
    pool.removeListener('remove', state.remove);
    tracked.delete(pool);
  }
}
