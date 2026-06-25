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
 *   - 给 HTML 响应【运行时注入】一条 staging 横幅 + 「放行上线」按钮（不写进 dist 文件，
 *     所以 promote 到生产的产物是干净的、不带横幅）。
 *   - POST /__staging__/promote → spawn promote-dashboard.sh（detached）把 staging 换入生产 5211。
 *
 * 不代理 /api（只验前端静态产物，不需要 Brain）。
 *
 * 环境变量：
 *   DIST_DIR        — 要 serve 的构建产物目录（必填）
 *   SLOT_PORT       — 监听端口（默认 5223，非生产）
 *   SLOT_HOST       — 监听地址（默认 0.0.0.0 对外；自检可设 127.0.0.1）
 *   STAGING_BANNER  — =1 时注入横幅 + 开放放行 endpoint（常驻 staging 用；自检不设）
 *   STAGING_COMMIT  — 横幅上显示的本次 commit（可选）
 *   STAGING_PORT_LABEL — 横幅/提示里显示给用户的端口（默认 = SLOT_PORT）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STATIC_DIR = process.env.DIST_DIR;
const PORT = parseInt(process.env.SLOT_PORT || '5223', 10);
const HOST = process.env.SLOT_HOST || '0.0.0.0';
const BANNER_ON = process.env.STAGING_BANNER === '1';
const STAGING_COMMIT = process.env.STAGING_COMMIT || 'unknown';
const PORT_LABEL = process.env.STAGING_PORT_LABEL || String(PORT);

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

// ── staging 横幅（运行时注入到 HTML 响应，不写文件）─────────────────────────
// id "__staging_banner__" 是稳定标记（smoke 据此断言注入到位 + 不在 dist 文件里）。
function bannerHtml() {
  const c = STAGING_COMMIT.replace(/[^a-zA-Z0-9_.-]/g, '');
  return `
<div id="__staging_banner__" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#f59e0b;color:#1f2937;font:14px/1.4 -apple-system,system-ui,sans-serif;padding:8px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.25)">
  <span>🟡 <b>STAGING 预览（待放行）</b> · commit <code>${c}</code> · 新版预览，生产 5211 还没动</span>
  <button id="__staging_promote_btn__" style="margin-left:auto;background:#1f2937;color:#fff;border:0;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:700">看好了，放行上线 ▶</button>
  <span id="__staging_status__" style="font-weight:700"></span>
</div>
<script>(function(){
  var b=document.getElementById('__staging_promote_btn__'),s=document.getElementById('__staging_status__');
  if(!b)return;
  b.onclick=function(){
    if(!confirm('确认放行上线到生产 5211？')) return;
    b.disabled=true; b.style.opacity=.5; s.textContent='放行中…';
    fetch('/__staging__/promote',{method:'POST'})
      .then(function(r){return r.json()})
      .then(function(){ s.textContent='✅ 已触发放行，约 3 秒后刷新 perfect21:5211 看新版'; })
      .catch(function(){ s.textContent='⚠️ 放行请求失败，可命令行跑 promote-dashboard.sh'; b.disabled=false; b.style.opacity=1; });
  };
})();</script>`;
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

  // ── 放行 endpoint：页面按钮点一下 → 触发 promote-dashboard.sh ───────────────
  // 先把响应发回去再 spawn（promote 末尾会 kill 本进程，避免响应没 flush 就被杀的竞态）。
  if (BANNER_ON && req.method === 'POST' && reqPath === '/__staging__/promote') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, msg: 'promote triggered' }));
    try {
      const promoteScript = path.join(__dirname, 'promote-dashboard.sh');
      const child = spawn('bash', [promoteScript], {
        detached: true,
        stdio: 'ignore',
        env: process.env, // 继承 CECELIA_DEPLOY_ROOT 等（测试隔离 + 生产正常解析）
      });
      child.unref();
    } catch (e) {
      // 响应已发出，promote 失败仅记日志
      console.error('[slot-server] spawn promote 失败:', e && e.message);
    }
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
