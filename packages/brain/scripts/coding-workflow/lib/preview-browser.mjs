// The controller writes this helper into the same read-only directory as CURL_HOME.
// Browser processes remain inside the native command sandbox; only the existing Unix bridge is reachable.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function installedPlaywright() {
  try { return require.resolve('playwright'); } catch { return null; }
}

// Serialized into a standalone CommonJS module; no controller closures or credentials cross the boundary.
function browserModule({ origin, socketPath, playwrightModule }) {
  const http = require('node:http');
  const fixed = new URL(origin);
  exports.launchPreviewBrowser = async (...options) => {
    if (options.length) throw new Error('preview_browser_options_unsupported');
    if (!playwrightModule) throw new Error('preview_browser_unavailable: Playwright is not installed in the trusted runner');
    const { chromium } = require(playwrightModule);
    // On macOS, multiprocess Chromium requires Mach registration denied by the native sandbox.
    // Single-process rendering works within that same sandbox, using Playwright's default pipe transport.
    const browsers = new Set();
    const pending = new Set(); const diagnostics = []; let closed = false;
    const note = (kind, url) => { if (diagnostics.length < 1000) diagnostics.push({ kind, url }); };
    const fetch = (request, url, requestHeaders) => new Promise((resolve, reject) => {
      if (closed) return reject(new Error('preview_browser_closed'));
      const headers = { ...requestHeaders, host: fixed.host, connection: 'close' };
      for (const key of ['proxy-authorization', 'proxy-connection', 'transfer-encoding', 'upgrade']) delete headers[key];
      const req = http.request({ socketPath, path: url.pathname + url.search, method: request.method(), headers, agent: false, timeout: 10000 }, (res) => {
        const chunks = []; let size = 0;
        res.on('data', (chunk) => { size += chunk.length; if (size > 8 * 1024 * 1024) res.destroy(new Error('preview_browser_body_limit')); else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => {
          if (closed) return reject(new Error('preview_browser_closed'));
          const headers = Object.fromEntries(Object.entries(res.headers)
            .filter(([k]) => !['connection', 'transfer-encoding', 'content-length'].includes(k))
            .map(([k, v]) => [k, Array.isArray(v) ? v.join('\n') : String(v)]));
          resolve({ status: res.statusCode, headers, body: Buffer.concat(chunks) });
        });
      });
      pending.add(req); req.on('close', () => pending.delete(req));
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('preview_browser_timeout')));
      req.end(request.postDataBuffer());
    });
    const close = async () => {
      if (closed) return;
      closed = true; for (const req of pending) req.destroy();
      await Promise.all([...browsers].map((browser) => browser.close()));
    };
    const newContext = async (...options) => {
      if (options.length) throw new Error('preview_browser_options_unsupported');
      if (closed) throw new Error('preview_browser_closed');
      // Closing an incognito context can terminate single-process Chromium; allocate one process per Q-n.
      const browser = await chromium.launch({ headless: true, args: ['--single-process', '--no-zygote'] });
      if (closed) { await browser.close(); throw new Error('preview_browser_closed'); }
      browsers.add(browser);
      let context;
      try { context = await browser.newContext({ serviceWorkers: 'block' }); }
      catch (error) { await browser.close(); browsers.delete(browser); throw error; }
      context.on('close', () => { void browser.close().catch(() => {}).finally(() => browsers.delete(browser)); });
      if (typeof context.routeWebSocket !== 'function') { await context.close(); throw new Error('preview_browser_unavailable: WebSocket blocking requires Playwright 1.48+'); }
      await context.routeWebSocket('**/*', async (ws) => {
        note('websocket_unsupported', ws.url());
        await ws.close({ code: 1008, reason: 'preview WebSocket transport is unsupported' });
      });
      await context.route('**/*', async (route) => {
        const request = route.request(); let url;
        try { url = new URL(request.url()); } catch { /* rejected below */ }
        if (!url || url.origin !== origin || url.username || url.password) {
          note('origin_blocked', request.url()); await route.abort('blockedbyclient'); return;
        }
        try { await route.fulfill(await fetch(request, url, await request.allHeaders())); }
        catch (error) {
          note('transport_failed', url.href);
          console.error(`PREVIEW_BROWSER_TRANSPORT_ERROR: ${error.message}`);
          await route.abort('failed');
        }
      });
      return context;
    };
    return Object.freeze({ newContext, close, diagnostics: () => diagnostics.map((d) => ({ ...d })) });
  };
}

export function writePreviewBrowserHelper({ runtimeDir, socketPath, origin, playwrightModule = installedPlaywright() }) {
  const file = path.join(runtimeDir, 'playwright-preview.cjs');
  fs.writeFileSync(file, `'use strict';\n(${browserModule.toString()})(${JSON.stringify({ origin, socketPath, playwrightModule })});\n`, { mode: 0o400 });
  return file;
}
