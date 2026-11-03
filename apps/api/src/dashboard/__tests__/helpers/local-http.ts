import { createServer, type RequestListener, type Server } from 'node:http';

/** 只起本人拥有的127.0.0.1随机端口，绝不读取服务地址环境变量。 */
export async function startLocalHttp(handler: RequestListener): Promise<Server> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return server;
}

export function localHttpUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('private HTTP fixture did not bind');
  return 'http://127.0.0.1:' + address.port;
}

export async function closeLocalHttp(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
