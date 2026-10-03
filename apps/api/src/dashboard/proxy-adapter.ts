import httpProxy from 'http-proxy';
import { parse } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { RequestHandler } from 'express';

type Rewrite = ((path: string, req: IncomingMessage) => string) | Record<string, string>;
type Options = httpProxy.ServerOptions & {
  pathRewrite?: Rewrite;
  on?: { error?: (error: Error, req: IncomingMessage, res: ServerResponse | Socket) => void };
};
type Middleware = RequestHandler & { upgrade(req: IncomingMessage, socket: Socket, head: Buffer): void };

function errorStatus(code?: string) {
  if (/HPE_INVALID/.test(code || '')) return 502;
  if (/HPM_ERR_INVALID_MULTIPART_/.test(code || '')) return 400;
  return ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code || '') ? 504 : 500;
}
function defaultPathMatches(uri?: string) {
  try { return !!uri && parse(uri).pathname?.indexOf('/') === 0; }
  catch { return false; }
}
const sanitize = (value?: string) => value?.replace(/[<>]/g, c => encodeURIComponent(c)) ?? '';
const observeSocketError = (socket: NodeJS.EventEmitter) => socket.on('error', () => {});

/** Only the seven Dashboard configurations: stream proxying without glob matching. */
export function createDashboardProxy(options: Options): Middleware {
  if (!options.target) throw new Error('Missing proxy target');
  const proxy = httpProxy.createProxyServer({});
  let upgradeSubscribed = false;
  let closeSubscribed = false;
  const rewrite = options.pathRewrite;
  const rules = typeof rewrite === 'object' ? Object.entries(rewrite).map(([key, value]) => [new RegExp(key), value] as const) : [];
  const pathRewriter: ((path: string, req: IncomingMessage) => string) | undefined = typeof rewrite === 'function' ? rewrite : rules.length ? path => {
    for (const [regex, replacement] of rules) if (regex.test(path)) return path.replace(regex, replacement);
    return path;
  } : undefined;
  proxy.on('error', (error, req, res) => {
    if (options.on?.error) { options.on.error(error, req, res); return; }
    if (!req && !res) throw error;
    if ('writeHead' in res) {
      if (!res.headersSent) res.writeHead(errorStatus((error as NodeJS.ErrnoException).code));
      res.end(`Error occurred while trying to proxy: ${sanitize(req.headers?.host)}${sanitize(req.url)}`);
    } else res.destroy();
  });
  proxy.on('proxyReq', (_outgoing, _req, socket) => observeSocketError(socket));
  proxy.on('proxyReqWs', (_outgoing, _req, socket) => observeSocketError(socket));
  proxy.on('open', observeSocketError);
  proxy.on('close', (_req, socket) => observeSocketError(socket));
  proxy.on('econnreset', () => {});
  proxy.on('proxyRes', (upstream, _req, response) => {
    response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
  });

  async function applyRouter() {
    // None of the seven actual configurations declares a router.
  }
  async function applyPathRewrite(req: IncomingMessage) {
    if (!pathRewriter) return;
    const path = await pathRewriter(req.url as string, req);
    if (typeof path === 'string') req.url = path;
  }
  async function prepare(req: IncomingMessage) {
    const activeOptions = { ...options };
    await applyRouter();
    await applyPathRewrite(req);
    return activeOptions;
  }
  async function handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
    try { if (defaultPathMatches(req.url)) proxy.ws(req, socket, head, await prepare(req)); }
    catch (error) { proxy.emit('error', error, req, socket); }
  }
  const middleware: RequestHandler = async (req, res, next) => {
    try {
      if (defaultPathMatches(req.url)) proxy.web(req, res, await prepare(req));
      else next();
    }
    catch (error) { next(error); }
    const server = (req.socket as Socket & { server?: import('node:http').Server }).server;
    if (server && !closeSubscribed) {
      server.on('close', () => proxy.close());
      closeSubscribed = true;
    }
    if (options.ws && server && !upgradeSubscribed) {
      server.on('upgrade', handleUpgrade);
      upgradeSubscribed = true;
    }
  };
  return Object.assign(middleware, {
    upgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
      if (!upgradeSubscribed) void handleUpgrade(req, socket, head);
    },
  });
}
