/**
 * dashboard-slot-server.cjs — staging slot 静态服务器
 *
 * 两个用途：
 *   1) 部署前自检（dashboard-staging-selfcheck.sh）：临时起、自检完即停，绑回环够用。
 *   2) 常驻 staging 预览（deploy-local.sh 停在 staging 时）：主理人从【自己电脑】打开
 *      perfect21:52xx 看，所以必须绑 0.0.0.0（像生产 5211 一样对外），否则只绑回环 → 外部
 *      打不开 → 浏览器把地址当搜索词。
 *
 * 行为对齐生产 frontend-proxy.js 的静态服务部分：
 *   - serve DIST_DIR 下的静态文件
 *   - 未命中文件 → SPA fallback 回 index.html（深层路由不被打回错误页）
 *   - /assets/* 未命中 → 真 404（戳穿白屏，不掩盖）
 *   - .html / sw.js / registerSW.js 禁缓存
 *
 * 常驻 staging 增强（STAGING_BANNER=1 时）：
 *   - 给 HTML 响应【运行时注入】一面右上角斜角 "STAGING" 小旗（不写进 dist 文件，
 *     所以 promote 到生产的产物是干净的、不带标识）。纯视觉、不可点、不挡内容。
 *   - 放行走命令行 promote-dashboard.sh（页面零交互，主理人决定）。
 *
 * 不代理 /api（只验前端静态产物，不需要 Brain）。
 *
 * 环境变量：
 *   DIST_DIR        — 要 serve 的构建产物目录（必填）
 *   SLOT_PORT       — 监听端口（默认 5223，非生产）
 *   SLOT_HOST       — 监听地址（默认 0.0.0.0 对外；自检可设 127.0.0.1）
 *   STAGING_BANNER  — =1 时注入 STAGING 角旗（常驻 staging 用；自检不设）
 *   STAGING_COMMIT  — 角旗 title 悬停显示的本次 commit（可选）
 *   STAGING_SLOT_NONCE — 本轮 64-hex slot 身份（仅 promote 本机核对后停进程）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC_DIR = process.env.DIST_DIR;
const PORT = parseInt(process.env.SLOT_PORT || '5223', 10);
const HOST = process.env.SLOT_HOST || '0.0.0.0';
const BANNER_ON = process.env.STAGING_BANNER === '1';
const STAGING_COMMIT = process.env.STAGING_COMMIT || 'unknown';
const STAGING_SLOT_NONCE = process.env.STAGING_SLOT_NONCE || '';
// 标识可配置：staging=橙 STAGING（默认）；dev 预览=蓝 DEV。文字/颜色由 env 覆盖。
const FLAG_TEXT = (process.env.STAGING_FLAG_TEXT || 'STAGING').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'STAGING';
const FLAG_COLOR = /^#[0-9a-fA-F]{3,8}$/.test(process.env.STAGING_FLAG_COLOR || '') ? process.env.STAGING_FLAG_COLOR : '#f97316';

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

// ── staging 标识（运行时注入到 HTML 响应，不写文件）─────────────────────────
// id "__staging_banner__" 是稳定标记（smoke 据此断言注入到位 + 不在 dist 文件里）。
// 纯视觉：右上角一面斜角小旗 "STAGING"，不可点、pointer-events:none 不挡 dashboard。
// 放行走命令行 promote-dashboard.sh（主理人决定，页面零交互）。
function bannerHtml() {
  const c = STAGING_COMMIT.replace(/[^a-zA-Z0-9_.-]/g, '');
  return `
<div id="__staging_banner__" title="${FLAG_TEXT} 预览 · commit ${c} · 生产 5211 未动（命令行 promote-dashboard.sh 放行）" style="position:fixed;top:0;right:0;width:74px;height:74px;overflow:hidden;z-index:2147483647;pointer-events:none">
  <div style="position:absolute;top:13px;right:-26px;transform:rotate(45deg);width:96px;text-align:center;background:${FLAG_COLOR};color:#fff;font:600 8px/1 -apple-system,system-ui,sans-serif;letter-spacing:.5px;padding:2px 0;box-shadow:0 1px 3px rgba(0,0,0,.3)">${FLAG_TEXT}</div>
</div>`;
}

function sendHtml(res, filePath) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('read error');
      return;
    }
    if (BANNER_ON) {
      const inject = bannerHtml();
      html = html.includes('</body>')
        ? html.replace('</body>', inject + '</body>')
        : html + inject;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(html);
  });
}

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  // 防目录穿越
  if (reqPath.includes('..')) {
    res.writeHead(400);
    res.end('bad path');
    return;
  }
  if (reqPath === '/.cecelia-staging-identity') {
    if (
      !BANNER_ON
      || !/^[0-9a-f]{40}$/.test(STAGING_COMMIT)
      || !/^[0-9a-f]{64}$/.test(STAGING_SLOT_NONCE)
    ) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(JSON.stringify({
      pid: process.pid,
      nonce: STAGING_SLOT_NONCE,
      commit: STAGING_COMMIT,
    }));
    return;
  }

  const filePath = path.join(STATIC_DIR, reqPath === '/' ? 'index.html' : reqPath);

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath);
      if (ext === '.html') {
        sendHtml(res, filePath); // HTML 走注入路径
        return;
      }
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      const basename = path.basename(filePath);
      if (basename === 'sw.js' || basename === 'registerSW.js') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      }
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    } else {
      // /assets/* 是带 hash 的不可变构建产物，未命中 = 真正的构建残缺（白屏真因），返回真 404，
      // 绝不 SPA fallback 成 index.html（那会把"缺 bundle"伪装成 200，漏判白屏）。
      const isAssetReq = reqPath.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(reqPath);
      if (isAssetReq && reqPath !== '/') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      // 导航路由（无扩展名）→ SPA fallback 回 index.html（含横幅注入）
      sendHtml(res, path.join(STATIC_DIR, 'index.html'));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[slot-server] staging slot up on http://${HOST}:${PORT} (dist=${STATIC_DIR}, banner=${BANNER_ON})`);
});

// 收到信号优雅退出（自检脚本 / promote kill 时）
['SIGTERM', 'SIGINT'].forEach((sig) => {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
});
