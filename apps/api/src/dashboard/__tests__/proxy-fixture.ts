import express from 'express';
import { createServer, request, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createDashboardProxy } from '../proxy-adapter.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createProxyMiddleware as createDockerBaseline } from 'hpm-docker-baseline';
export type ProxyMode = 'baseline' | 'docker-baseline' | 'candidate';
export const createFactory = (mode: ProxyMode) => mode === 'baseline' ? createProxyMiddleware : mode === 'docker-baseline' ? createDockerBaseline : createDashboardProxy;

// Await the real events of resources created by this fixture; do not reset counts.
export async function closeOwnedResources(servers: Server[], sockets: Set<Socket>) {
  const socketClosed = [...sockets].map(socket => new Promise<void>(resolve => socket.once('close', resolve)));
  const serverClosed = servers.filter(server => server.listening).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  for (const socket of sockets) socket.destroy();
  await Promise.all([...socketClosed, ...serverClosed]);
  if (sockets.size || servers.some(server => server.listening)) throw new Error('Owned fixture cleanup incomplete');
}

const source = readFileSync('src/dashboard/server.ts', 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const configs: ts.Expression[] = [];
let upgrade: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createDashboardProxy') configs.push(node.arguments[0]);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'server.on' && node.arguments[0]?.getText(ast) === "'upgrade'") upgrade = node.arguments[1];
  ts.forEachChild(node, visit);
}
visit(ast);
if (configs.length !== 7 || !upgrade) throw new Error('Actual seven proxy configurations or upgrade callback missing');
export const mounts = ['/api/quality', '/api/orchestrator', '/api/autumnrice', '/api/brain', null, '/api/v1', '/n8n'] as const;
export function actualOptions(index: number, target: string) {
  const js = ts.transpileModule(`(${configs[index].getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(js, { QUALITY_API: target, BRAIN_API: target, BRAIN_NODE_API: target, AUTOPILOT_BACKEND: target, N8N_BACKEND: target }, { timeout: 1000 });
}
export const actualSource = source;
export type Seen = { method?: string; url?: string; host?: string; body: Buffer };
export async function harness(handle?: (req: IncomingMessage, res: ServerResponse) => void, targetSuffix = '', mode: ProxyMode = 'candidate') {
  const sockets = new Set<Socket>();
  const trackSocket = (socket: Socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket; };
  const servers: Server[] = [];
  const track = (server: Server) => {
    servers.push(server);
    server.on('connection', trackSocket);
    return server;
  };
  async function listen(server: Server) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing owned port');
    return `http://127.0.0.1:${address.port}`;
  }
  const seen: Seen[] = [];
  const backend = track(createServer(handle || ((req, res) => {
    const chunks: Buffer[] = []; req.on('data', b => chunks.push(Buffer.from(b)));
    req.on('end', () => { const row = { method: req.method, url: req.url, host: req.headers.host, body: Buffer.concat(chunks) }; seen.push(row); res.setHeader('x-fixture', 'owned'); res.end(row.body.length ? row.body : 'ok'); });
  })));
  const target = (await listen(backend)) + targetSuffix;
  const app = express();
  app.get('/api/orchestrator/queue', (_req, res) => res.end('local queue'));
  app.get('/api/v1/vps-monitor/local', (_req, res) => res.end('local monitor'));
  const proxies = mounts.map((mount, i) => { const proxy = createFactory(mode)(actualOptions(i, target)); if (mount) app.use(mount, proxy); return proxy; });
  app.use(express.json());
  const front = track(createServer(app));
  const js = ts.transpileModule(`(${upgrade!.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  front.on('upgrade', vm.runInNewContext(js, { orchestratorProxy: proxies[1], brainWsProxy: proxies[4], console: { log() {} } }, { timeout: 1000 }));
  const origin = await listen(front);
  const owned = new Set([new URL(target).port, new URL(origin).port]);
  const timers = new Set<NodeJS.Timeout>();
  const later = (fn: () => void, ms: number) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; };
  async function call(path: string, body?: Buffer, headers: Record<string, string> = {}) {
    const url = new URL(path, origin);
    if (url.hostname !== '127.0.0.1' || !owned.has(url.port)) throw new Error('Unowned client target');
    return new Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }>((resolve, reject) => {
      const req = request(url, { method: body ? 'POST' : 'GET', headers }, res => { const chunks: Buffer[] = []; res.on('data', b => chunks.push(Buffer.from(b))); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) })); res.on('error', reject); });
      req.on('socket', trackSocket);
      const deadline = later(() => req.destroy(new Error('owned client deadline')), 15000);
      req.once('close', () => { clearTimeout(deadline); timers.delete(deadline); });
      req.on('error', reject); req.end(body);
    });
  }
  async function cleanup() {
    for (const t of timers) clearTimeout(t); timers.clear();
    await closeOwnedResources(servers, sockets);
    if (sockets.size || servers.some(s => s.listening) || timers.size) throw new Error('Owned fixture cleanup incomplete');
  }
  return { mode, trackSocket, seen, backend, front, target, origin, owned, sockets, later, call, cleanup, proxies };
}
