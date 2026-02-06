/**
 * Frontend Proxy Server
 * Serves static files from /app and proxies /api/* to Core Express server (5211)
 * Used by cecelia-frontend Docker container on port 5212
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5212;
const API_TARGET = 'http://localhost:5211';
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
  // Proxy /api/* and /n8n/* to Core Express server
  if (req.url.startsWith('/api/') || req.url.startsWith('/n8n/')) {
    const options = {
      hostname: 'localhost',
      port: 5211,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: 'localhost:5211' },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`Proxy error: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Backend unavailable' }));
    });

    req.pipe(proxyReq);
    return;
  }

  // Serve static files
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);
  // Strip query string
  filePath = filePath.split('?')[0];

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      // No cache for HTML and service worker files - force fresh load
      const basename = path.basename(filePath);
      if (ext === '.html' || basename === 'sw.js' || basename === 'registerSW.js' || basename === 'workbox-4b126c97.js') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
        headers['Expires'] = '0';
      }
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA fallback - serve index.html for all other routes
      const indexPath = path.join(STATIC_DIR, 'index.html');
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      fs.createReadStream(indexPath).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Frontend proxy running on http://localhost:${PORT}`);
  console.log(`API proxy target: ${API_TARGET}`);
  console.log(`Static dir: ${STATIC_DIR}`);
});
