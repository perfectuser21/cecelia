// 仅供隔离验收：本机固定操作人和租户，不能作为生产用户认证。
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const mime = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
function requestPreviewBrain(upstream, {path, method, headers, body}) {
  return new Promise((resolveResponse, reject) => {
    // 网络目的地址只来自已校验的服务端配置；客户端数据只允许成为HTTP path。
    const outgoing = httpRequest({hostname:upstream.hostname.replace(/^\[|\]$/g,''), port:upstream.port, method, headers, path, timeout:20000}, incoming => {
      let data = '';
      incoming.on('data', chunk => { data += chunk; if (Buffer.byteLength(data) > 2097152) { outgoing.destroy(Error('preview响应过大')); } });
      incoming.on('end', () => resolveResponse({status:incoming.statusCode, text:async () => data}));
      incoming.on('error', reject);
    });
    outgoing.on('timeout', () => outgoing.destroy(Error('preview响应超时')));
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}
export function createInvocationPreview({ brainOrigin, tenantId, operatorId, token, staticRoot = fileURLToPath(new URL('../dist/',import.meta.url)), fetcher = requestPreviewBrain } = {}) {
  const upstream = new URL(brainOrigin);
  if (upstream.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(upstream.hostname) || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) throw Error('preview后端必须为明确的本机隔离Brain');
  if (![tenantId,operatorId,token].every(value => typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value))) throw Error('preview必须显式指定服务端租户、操作人和内部凭据');
  const root = resolve(staticRoot);
  const server = createServer(async (request,response) => {
    const fail = (status,message) => response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:{message}}));
    const address = server.address();
    const host = `127.0.0.1:${typeof address === 'object' && address ? address.port : ''}`;
    const origin = `http://${host}`;
    if (request.headers.host !== host || !['127.0.0.1','::ffff:127.0.0.1','::1'].includes(request.socket.remoteAddress)) return fail(403,'只允许本机preview访问');
    const url = new URL(request.url || '/',origin);
    if (url.pathname.startsWith('/api/')) {
      if (request.headers.origin !== origin && !(request.method === 'GET' && request.headers['sec-fetch-site'] === 'same-origin')) return fail(403,'preview请求来源不符');
      if (request.headers['x-tenant-id'] || request.headers['x-internal-token'] || request.headers.authorization || request.headers['x-invocation-operator']) return fail(403,'身份只能由preview服务端指定');
      const invocation = /^\/api\/brain\/invocations(?:\/resolve|\/by-request\/[\w.-]+|\/[\w.-]+)?$/.test(url.pathname);
      const readMap = request.method === 'GET' && /^\/api\/brain\/map\/(?:registry|runs|releases)(?:\/[\w.-]+\/evidence)?$/.test(url.pathname);
      const allowedMethod = request.method === 'GET' || (request.method === 'POST' && ['/api/brain/invocations','/api/brain/invocations/resolve'].includes(url.pathname));
      if (!(invocation && allowedMethod) && !readMap) return fail(404,'该接口不在preview白名单');
      try {
        let body = '';
        for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 1048576) return fail(413,'请求过大'); }
        const headers = { 'Content-Type':'application/json', 'x-internal-token':token, 'x-tenant-id':tenantId, 'x-invocation-operator':operatorId };
        const result = await fetcher(upstream, { path:url.pathname+url.search, method:request.method, headers, ...(request.method === 'POST' ? { body } : {}) });
        const data = await result.text();
        if (data.includes(token)) return fail(502,'后端响应包含内部凭据，已拒绝返回');
        response.writeHead(result.status, {'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}).end(data);
      } catch { fail(502,'隔离Brain不可用；调用结果需按原请求查回'); }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405,'只允许读取静态页面');
    try {
      let path = resolve(root, '.'+decodeURIComponent(url.pathname));
      if (path !== root && !path.startsWith(root+sep)) return fail(403,'路径不允许');
      let data;
      try { data = await readFile(path); } catch { if (extname(path)) return fail(404,'静态资源不存在'); path = resolve(root,'index.html'); data = await readFile(path); }
      response.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(request.method === 'HEAD' ? undefined : data);
    } catch { fail(404,'preview构建产物不存在'); }
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createInvocationPreview({brainOrigin:process.env.INVOCATION_PREVIEW_BRAIN,tenantId:process.env.INVOCATION_PREVIEW_TENANT,operatorId:process.env.INVOCATION_PREVIEW_OPERATOR,token:process.env.INVOCATION_PREVIEW_TOKEN});
  server.listen(Number(process.env.INVOCATION_PREVIEW_PORT || 5291),'127.0.0.1',() => { process.stdout.write(`受控本机preview：http://127.0.0.1:${server.address().port}\n`); });
}
