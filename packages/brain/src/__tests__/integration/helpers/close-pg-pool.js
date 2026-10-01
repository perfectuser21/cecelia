/** pg-pool 的 end 先移除 clients 再回调；remove 事件才确认 socket 已退出。 */
export async function closePgPool(pool) {
  const count = pool.totalCount;
  if (!count) return pool.end();
  let removed = 0;
  let onRemove;
  let timer;
  const socketsClosed = new Promise((resolve, reject) => {
    onRemove = () => { if (++removed === count) resolve(); };
    pool.on('remove', onRemove);
    timer = setTimeout(() => reject(new Error('PG 测试连接退出超时')), 5000);
  });
  try {
    await Promise.all([pool.end(), socketsClosed]);
  } finally {
    clearTimeout(timer);
    pool.removeListener('remove', onRemove);
  }
}
