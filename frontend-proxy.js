/**
 * Frontend Proxy Server
 * Serves static files from /app and proxies /api/brain/* directly to Brain (5221)
 * Used by cecelia-frontend Docker container on port 5211
 * Supports WebSocket upgrade via TCP tunnel (net.createConnection)
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = 5211;
const BRAIN_PORT = 5221;
const STATIC_DIR = '/app';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  // Proxy /api/brain/* directly to Brain service
  if (req.url.startsWith('/api/brain/')) {
    const options = {
      hostname: 'localhost',
      port: BRAIN_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${BRAIN_PORT}` },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`Brain proxy error: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Brain service unavailable' }));
    });

    req.pipe(proxyReq);
    return;
  }

  // Proxy HK VPS stats → 100.86.118.99:5211 (HK Brain port, via Tailscale)
  if (req.url.startsWith('/api/v1/vps-monitor/hk-stats')) {
    const options = {
      hostname: '100.86.118.99',
      port: 5211,
      path: '/api/v1/vps-monitor/stats',
      method: 'GET',
      headers: { host: '100.86.118.99:5211' },
      timeout: 5000,
    };
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'HK VPS unreachable' }));
    });
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'HK VPS timeout' }));
    });
    proxyReq.end();
    return;
  }

  // Proxy other /api/* to Brain (orchestrator, autumnrice, etc. are all under Brain now)
  if (req.url.startsWith('/api/')) {
    // Rewrite /api/v1/vps-monitor/* → /api/brain/vps-monitor/* (strip legacy /v1 prefix)
    let targetPath;
    if (req.url.startsWith('/api/v1/vps-monitor')) {
      targetPath = `/api/brain/vps-monitor${req.url.slice('/api/v1/vps-monitor'.length)}`;
    } else {
      targetPath = `/api/brain${req.url.slice(4)}`;
    }
    const options = {
      hostname: 'localhost',
      port: BRAIN_PORT,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${BRAIN_PORT}` },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`API proxy error: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API unavailable' }));
    });

    req.pipe(proxyReq);
    return;
  }

  // Serve static files
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);
  filePath = filePath.split('?')[0];

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      const basename = path.basename(filePath);
      if (ext === '.html' || basename === 'sw.js' || basename === 'registerSW.js') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
        headers['Expires'] = '0';
      }
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA fallback
      const indexPath = path.join(STATIC_DIR, 'index.html');
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      fs.createReadStream(indexPath).pipe(res);
    }
  });
});

// WebSocket upgrade — proxy directly to Brain
server.on('upgrade', (req, clientSocket, head) => {
  if (req.url.startsWith('/api/brain/ws')) {
    // Rewrite path: /api/brain/ws → /ws
    const targetUrl = req.url.replace('/api/brain/ws', '/ws');
    const targetSocket = net.createConnection(BRAIN_PORT, 'localhost', () => {
      let requestLine = `${req.method} ${targetUrl} HTTP/1.1\r\n`;
      let headers = '';
      for (const [k, v] of Object.entries(req.headers)) {
        // Rewrite origin/host to localhost so Brain's origin check passes
        if (k === 'origin') {
          headers += `origin: http://localhost:${PORT}\r\n`;
        } else if (k === 'host') {
          headers += `host: localhost:${BRAIN_PORT}\r\n`;
        } else {
          headers += `${k}: ${v}\r\n`;
        }
      }
      targetSocket.write(requestLine + headers + '\r\n');
      if (head && head.length) targetSocket.write(head);
    });

    targetSocket.on('data', (data) => clientSocket.write(data));
    clientSocket.on('data', (data) => targetSocket.write(data));
    targetSocket.on('end', () => clientSocket.end());
    clientSocket.on('end', () => targetSocket.end());
    targetSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => targetSocket.destroy());
  } else {
    clientSocket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Frontend proxy running on http://localhost:${PORT}`);
  console.log(`Brain target: http://localhost:${BRAIN_PORT}`);
  console.log(`Static dir: ${STATIC_DIR}`);
});
