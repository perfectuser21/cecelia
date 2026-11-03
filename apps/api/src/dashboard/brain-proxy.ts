import { createProxyMiddleware } from 'http-proxy-middleware';

export function createBrainProxy(target: string) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path) => `/api/brain${path}`,
    // HTTP only: ws:true auto-registers an upgrade listener that conflicts with
    // the server's dedicated /api/brain/ws handler.
  });
}
