import { it, expect } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import lock from '../../../../../../package-lock.json';

const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const require = createRequire(import.meta.url);
// 锁文件选择全部实际安装实例，不以版本镜像断言代替网络行为。
const instances = Object.keys(lock.packages).filter(path => /(?:^|\/)node_modules\/follow-redirects$/.test(path)).sort();
const keys = ['Authorization', 'Cookie', 'Proxy-Authorization', 'X-Sensitive^Name'];
const cases = instances.flatMap(path => ['array', 'object'].flatMap(shape => ['/read', '/same', '/cross'].map(route => ({ path, shape, route }))));

it('锁定依赖必须提供至少一个受测实例', () => expect(instances.length).toBeGreaterThan(0));
it.each(cases)('$path $shape $route 保留正常头并隔离跨源敏感头', async ({ path, shape, route }) => {
  expect(path).toMatch(/^(?:node_modules\/(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+\/)*node_modules\/follow-redirects$/);
  const installed = realpathSync(join(root, path));
  const resolved = require.resolve(join(root, path));
  // 必须加载锁定路径自己的实现，缺安装或外部/提升回退均不能冒充通过。
  expect(realpathSync(dirname(resolved))).toBe(installed);
  expect(installed).toBe(join(realpathSync(root), path));
  const follow = require(resolved), servers = [];
  try {
    const destination = http.createServer((req, res) => res.end(JSON.stringify(req.headers)));
    servers.push(destination); destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
    const origin = http.createServer((req, res) => {
      if (req.url === '/cross') { res.writeHead(302, { Location: `http://127.0.0.1:${destination.address().port}/read` }); res.end(); }
      else if (req.url === '/same') { res.writeHead(302, { Location: '/read' }); res.end(); }
      else res.end(JSON.stringify(req.headers));
    });
    servers.push(origin); origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
    const pairs = ['Host', `127.0.0.1:${origin.address().port}`, ...keys.flatMap((key, i) => [key, `synthetic-${i}`]), 'X-Control', 'public-control'];
    const headers = shape === 'array' ? pairs : Object.fromEntries(Array.from({ length: pairs.length / 2 }, (_, i) => pairs.slice(2 * i, 2 * i + 2)));
    const observed = await new Promise((resolve, reject) => {
      const request = follow.http.get({ hostname: '127.0.0.1', port: origin.address().port, path: route, headers,
        sensitiveHeaders: ['X-Sensitive^Name'], timeout: 3000 }, response => {
        let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
        response.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
        response.on('error', reject);
      });
      request.on('error', reject); request.on('timeout', () => request.destroy(Error('loopback fixture deadline')));
    });
    for (const [i, key] of keys.entries()) expect(observed[key.toLowerCase()], key).toBe(route === '/cross' ? undefined : `synthetic-${i}`);
    expect(observed['x-control']).toBe('public-control');
  } finally { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
});
