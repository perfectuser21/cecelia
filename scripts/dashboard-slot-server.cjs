/**
 * dashboard-slot-server.cjs — staging slot 静态服务器（部署前自检专用）
 *
 * 行为对齐生产 frontend-proxy.js 的静态服务部分：
 *   - serve DIST_DIR 下的静态文件
 *   - 未命中文件 → SPA fallback 回 index.html（深层路由不被打回错误页）
 *   - .html / sw.js / registerSW.js 禁缓存
 *
 * 不代理 /api（slot 自检只验前端静态产物，不需要 Brain）。
 *
 * 环境变量：
 *   DIST_DIR   — 要 serve 的构建产物目录（必填）
 *   SLOT_PORT  — 监听端口（默认 5223，非生产）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC_DIR = process.env.DIST_DIR;
const PORT = parseInt(process.env.SLOT_PORT || '5223', 10);

if (!STATIC_DIR) {
  console.error('[slot-server] DIST_DIR 未设置');
  process.exit(1);
}
if (!fs.existsSync(path.join(STATIC_DIR, 'index.html'))) {
  console.error(`[slot-server] ${STATIC_DIR}/index.html 不存在`);
  process.exit(1);
}

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
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  // 防目录穿越
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (reqPath.includes('..')) {
    res.writeHead(400);
    res.end('bad path');
    return;
  }

  let filePath = path.join(STATIC_DIR, reqPath === '/' ? 'index.html' : reqPath);

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      const basename = path.basename(filePath);
      if (ext === '.html' || basename === 'sw.js' || basename === 'registerSW.js') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      }
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    } else {
      // /assets/* 是带 hash 的不可变构建产物（JS/CSS/字体等）。
      // 这类请求未命中文件 = 真正的构建残缺（白屏真因），必须返回真 404，
      // 绝不能 SPA fallback 成 index.html（那会把"缺 bundle"伪装成 200，漏判白屏）。
      // 这正是与生产 frontend-proxy.js 的关键区别 —— 自检要能戳穿白屏，不能掩盖它。
      const isAssetReq = reqPath.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(reqPath);
      if (isAssetReq && reqPath !== '/') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      // 导航路由（无扩展名）→ SPA fallback 回 index.html（200 + #root 外壳）
      const indexPath = path.join(STATIC_DIR, 'index.html');
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      fs.createReadStream(indexPath).pipe(res);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[slot-server] staging slot up on http://127.0.0.1:${PORT} (dist=${STATIC_DIR})`);
});

// 收到信号优雅退出（自检脚本 kill 时）
['SIGTERM', 'SIGINT'].forEach((sig) => {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
});
