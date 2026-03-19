#!/usr/bin/env node
/**
 * 快手视频发布脚本
 *
 * 技术方案：CDP 提取 Cookie → HTTP API 直接调用
 *
 * 与图文方案（publish-kuaishou-api.cjs）对齐：
 *   CDP 仅用于提取 Cookie → HTTP 直接调用视频上传/发布接口
 *
 * 发布流程：
 *   1. CDP 连接 Windows Chrome → 提取快手创作者中心 Cookie
 *   2. 通过 REST API 获取视频上传 Token
 *   3. 上传视频文件（支持大文件分块）
 *   4. 可选：上传封面图
 *   5. POST 发布接口 → 创建视频内容，返回作品 ID
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-kuaishou-video.cjs \
 *     --video /path/to/video.mp4 \
 *     --title "视频标题" \
 *     [--tags "标签1,标签2"] \
 *     [--cover /path/to/cover.jpg]
 *
 * 退出码：
 *   0 - 发布成功
 *   1 - 发布失败（CDP 错误、API 错误等）
 *   2 - 会话失效（需重新登录）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 *
 * 注意：若接口返回 404，请通过 Chrome DevTools Network 面板捕获真实端点：
 *   在 Windows Chrome 打开快手 CP，发布视频时记录实际请求 URL 并更新常量。
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ============================================================
// 配置
// ============================================================

const CDP_PORT = 19223;
const WINDOWS_IP = '100.97.242.124';

/**
 * 快手创作者中心 Cookie 域
 */
const KUAISHOU_COOKIE_DOMAINS = [
  'https://kuaishou.com',
  'https://cp.kuaishou.com',
  'https://www.kuaishou.com',
  'https://u.kuaishou.com',
];

/**
 * 快手视频上传/发布 API 端点
 *
 * NOTE: 若接口返回 404，请通过 Chrome DevTools Network 面板捕获真实端点：
 *   在 Windows Chrome 打开快手 CP，发布视频时记录 Network 中上传/发布相关请求 URL 并更新此处。
 */
const KUAISHOU_VIDEO_UPLOAD_TOKEN_URL = 'https://cp.kuaishou.com/rest/cp/works/upload/video/token';
const KUAISHOU_VIDEO_UPLOAD_URL = 'https://cp.kuaishou.com/rest/cp/works/upload/video/fragment';
const KUAISHOU_VIDEO_COMPLETE_URL = 'https://cp.kuaishou.com/rest/cp/works/upload/video/complete';
const KUAISHOU_COVER_UPLOAD_TOKEN_URL = 'https://cp.kuaishou.com/rest/cp/works/upload/photo/token';
const KUAISHOU_VIDEO_PUBLISH_URL = 'https://cp.kuaishou.com/rest/cp/works/video/new';

/**
 * 视频分块大小：4MB
 */
const CHUNK_SIZE = 4 * 1024 * 1024;

// ============================================================
// 纯工具函数（可单元测试）
// ============================================================

/**
 * 从 CDP Network.getCookies 响应解析 Cookie Header 字符串和会话 Token
 *
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {{ cookieHeader: string, sessionToken: string|null, userId: string|null }}
 */
function parseCookieHeader(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return { cookieHeader: '', sessionToken: null, userId: null };
  }
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const sessionToken =
    cookies.find(
      c => c.name === 'kuaishou.web.cp.api_st' || c.name === 'kuaishou.web.cp.api_ph'
    )?.value || null;
  const userId = cookies.find(c => c.name === 'userId')?.value || null;
  return { cookieHeader, sessionToken, userId };
}

/**
 * 检测快手 CP 会话是否有效
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {boolean}
 */
function isSessionValid(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  return cookies.some(
    c => c.name === 'kuaishou.web.cp.api_st' || c.name === 'kuaishou.web.cp.api_ph'
  );
}

/**
 * 检测响应是否为登录失效错误
 * @param {number} statusCode
 * @param {string} body
 * @returns {boolean}
 */
function isLoginError(statusCode, body) {
  if (statusCode === 401 || statusCode === 403) return true;
  if (!body || typeof body !== 'string') return false;
  const lower = body.toLowerCase();
  const loginKeywords = [
    '未登录', '请登录', 'not login', '登录失效',
    'login required', '登录过期', 'session expired',
  ];
  return loginKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 检测响应是否为频率限制错误
 * @param {string} body
 * @returns {boolean}
 */
function isRateLimit(body) {
  if (!body || typeof body !== 'string') return false;
  const lower = body.toLowerCase();
  const rateLimitKeywords = [
    '频率限制', '操作频繁', '操作太频繁', '发布太频繁', 'too frequent', 'rate limit',
  ];
  return rateLimitKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 解析快手 API 响应
 *
 * 快手 CP API 通常返回：
 *   { result: 1, data: { ... } }  — 成功
 *   { result: 0, error_msg: "..." } — 失败
 *
 * @param {string} body
 * @returns {{ ok: boolean, data: any, errorMsg: string|null }}
 */
function parseKuaishouResponse(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, data: null, errorMsg: `响应解析失败: ${body.slice(0, 200)}` };
  }

  const ok =
    parsed?.result === 1 ||
    parsed?.code === 200 ||
    parsed?.code === '200' ||
    parsed?.status === 'success';

  const errorMsg = ok
    ? null
    : parsed?.error_msg ||
      parsed?.message ||
      parsed?.msg ||
      `API 错误: ${JSON.stringify(parsed).slice(0, 200)}`;

  return { ok, data: parsed?.data ?? parsed, errorMsg };
}

/**
 * 解析命令行参数
 * @param {string[]} argv - process.argv
 * @returns {{ video: string|null, title: string|null, tags: string[], cover: string|null }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const get = key => {
    const idx = args.indexOf(key);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };

  const tagsRaw = get('--tags');
  const tags = tagsRaw
    ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  return {
    video: get('--video'),
    title: get('--title'),
    tags,
    cover: get('--cover'),
  };
}

/**
 * 构建封面图上传的 multipart form-data Body
 *
 * @param {Buffer} imageBuffer - 图片二进制数据
 * @param {string} filename - 文件名
 * @param {string} boundary - multipart boundary
 * @param {Object} extraFields - 额外表单字段
 * @returns {Buffer} 完整的 multipart body
 */
function buildImageUploadForm(imageBuffer, filename, boundary, extraFields) {
  const fields = extraFields || {};
  const CRLF = '\r\n';
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const mimeType = mimeMap[ext] || 'image/jpeg';

  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
        `${value}${CRLF}`
    );
  }

  const fileHeader =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}${CRLF}`;

  const fileFooter = `${CRLF}--${boundary}--${CRLF}`;

  return Buffer.concat([
    Buffer.from(parts.join('')),
    Buffer.from(fileHeader),
    imageBuffer,
    Buffer.from(fileFooter),
  ]);
}

// ============================================================
// HTTP 请求工具
// ============================================================

/**
 * 发起 HTTP/HTTPS 请求
 */
function httpRequest(urlStr, method, body, headers, timeoutMs) {
  const ms = timeoutMs || 30000;
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const bodyBuffer = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: Object.assign(
        {},
        headers,
        body ? { 'Content-Length': bodyBuffer.length } : {}
      ),
    };

    const req = transport.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () =>
        resolve({ statusCode: res.statusCode, body: data, headers: res.headers })
      );
    });

    req.on('error', reject);
    req.setTimeout(ms, () => {
      req.destroy(new Error(`请求超时: ${urlStr}`));
    });
    if (body) req.write(bodyBuffer);
    req.end();
  });
}

/**
 * 带重试的异步操作
 */
async function withRetry(fn, maxRetries, delayMs, isRetryable) {
  const retries = maxRetries || 3;
  const delay = delayMs || 2000;
  const canRetry = isRetryable || (() => true);
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && canRetry(err)) {
        await new Promise(r => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

// ============================================================
// CDP 客户端（内联版本，避免跨 skill 依赖）
// ============================================================

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
  }

  connect() {
    const WebSocket = require('ws');
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks[msg.id]) {
          this.callbacks[msg.id](msg);
          delete this.callbacks[msg.id];
        }
      });
    });
  }

  send(method, params) {
    const p = params || {};
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        if (this.callbacks[id]) {
          delete this.callbacks[id];
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
      this.callbacks[id] = msg => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      this.ws.send(JSON.stringify({ id, method, params: p }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ============================================================
// 核心业务逻辑
// ============================================================

function getCDPPages(ip, port) {
  return withRetry(
    () =>
      new Promise((resolve, reject) => {
        http
          .get(`http://${ip}:${port}/json`, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`CDP 响应解析失败: ${e.message}`));
              }
            });
          })
          .on('error', err =>
            reject(
              new Error(
                `[CDP_ERROR] 无法连接 CDP (${ip}:${port}): ${err.message}\n` +
                  `排查：curl http://${ip}:${port}/json`
              )
            )
          );
      }),
    3,
    2000
  );
}

async function extractKuaishouSession(cdp) {
  await cdp.send('Network.enable');

  const cookiesResult = await cdp.send('Network.getCookies', {
    urls: KUAISHOU_COOKIE_DOMAINS,
  });

  const cookies = cookiesResult.cookies || [];
  console.log(`   提取到 ${cookies.length} 个 Cookie`);

  if (!isSessionValid(cookies)) {
    const foundNames = cookies.map(c => c.name).join(', ') || '（无）';
    throw new Error(
      `[SESSION_EXPIRED] 会话失效：未找到快手 CP 会话令牌\n` +
        `  期望: kuaishou.web.cp.api_st 或 kuaishou.web.cp.api_ph\n` +
        `  实际: ${foundNames}\n` +
        `  请在 Windows Chrome (CDP 端口 ${CDP_PORT}) 重新登录 cp.kuaishou.com`
    );
  }

  const { cookieHeader, sessionToken, userId } = parseCookieHeader(cookies);
  console.log(`   Session Token: ${sessionToken ? '✅ 已获取' : '⚠️  未找到'}`);
  console.log(`   User ID: ${userId || '（未知）'}`);

  return { cookieHeader, sessionToken, userId };
}

/**
 * 获取视频上传 Token
 */
async function getVideoUploadToken(cookieHeader) {
  const headers = {
    Cookie: cookieHeader,
    'Content-Type': 'application/json',
    Referer: 'https://cp.kuaishou.com/',
    Origin: 'https://cp.kuaishou.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json, text/plain, */*',
  };

  const response = await withRetry(
    () => httpRequest(KUAISHOU_VIDEO_UPLOAD_TOKEN_URL, 'POST', JSON.stringify({}), headers),
    3,
    2000,
    err => !err.message.includes('SESSION_EXPIRED')
  );

  if (isLoginError(response.statusCode, response.body)) {
    throw new Error('[SESSION_EXPIRED] 会话失效：获取视频上传 Token 时收到登录错误');
  }
  if (response.statusCode === 404) {
    throw new Error(
      `视频上传 Token 接口返回 404，端点可能已变更。\n` +
        `当前端点: ${KUAISHOU_VIDEO_UPLOAD_TOKEN_URL}\n` +
        `排查：在 Windows Chrome 打开快手 CP，发布视频时记录 Network 中上传相关请求 URL`
    );
  }
  if (response.statusCode !== 200) {
    throw new Error(
      `获取视频上传 Token 失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 300)}`
    );
  }

  const { ok, data, errorMsg } = parseKuaishouResponse(response.body);
  if (!ok) throw new Error(`获取视频上传 Token API 错误: ${errorMsg}`);

  const uploadToken =
    data?.token || data?.upload_token || data?.uploadToken || data?.accessToken;
  const uploadEndpoint =
    data?.endpoint || data?.upload_url || data?.uploadUrl || KUAISHOU_VIDEO_UPLOAD_URL;
  const tokenKey = data?.key || data?.file_key || null;
  const uploadId = data?.upload_id || data?.uploadId || null;

  if (!uploadToken) {
    throw new Error(
      `视频上传 Token 响应中未找到 token 字段: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  return { uploadToken, uploadEndpoint, tokenKey, uploadId };
}

/**
 * 上传视频文件（支持分块上传）
 *
 * @param {string} videoPath - 视频文件路径
 * @param {string} cookieHeader - Cookie Header
 * @param {Object} tokenInfo - 上传 Token 信息
 * @returns {Promise<string>} 视频 ID / key
 */
async function uploadVideo(videoPath, cookieHeader, tokenInfo) {
  const { uploadToken, uploadEndpoint, tokenKey, uploadId } = tokenInfo;
  const videoBuffer = fs.readFileSync(videoPath);
  const filename = path.basename(videoPath);
  const ext = path.extname(filename).toLowerCase();
  const videoMimeMap = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',
  };
  const mimeType = videoMimeMap[ext] || 'video/mp4';

  const totalSize = videoBuffer.length;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

  console.log(`   视频大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   分块数量: ${totalChunks}`);

  const baseHeaders = {
    Cookie: cookieHeader,
    Referer: 'https://cp.kuaishou.com/',
    Origin: 'https://cp.kuaishou.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json, text/plain, */*',
  };

  // 单块直接上传（≤4MB）
  if (totalChunks === 1) {
    const boundary = `----KuaishouVideoBoundary${Date.now().toString(16)}`;
    const CRLF = '\r\n';

    const extraFields = Object.assign(
      { token: uploadToken },
      tokenKey ? { key: tokenKey.replace('{filename}', filename) } : {},
      uploadId ? { upload_id: uploadId } : {}
    );

    const parts = [];
    for (const [name, value] of Object.entries(extraFields)) {
      parts.push(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
          `${value}${CRLF}`
      );
    }
    const fileHeader =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`;
    const fileFooter = `${CRLF}--${boundary}--${CRLF}`;

    const formBody = Buffer.concat([
      Buffer.from(parts.join('')),
      Buffer.from(fileHeader),
      videoBuffer,
      Buffer.from(fileFooter),
    ]);

    const response = await withRetry(
      () =>
        httpRequest(
          uploadEndpoint,
          'POST',
          formBody,
          Object.assign({}, baseHeaders, {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          }),
          120000
        ),
      3,
      3000,
      err => !err.message.includes('SESSION_EXPIRED')
    );

    if (response.statusCode !== 200 && response.statusCode !== 201) {
      throw new Error(
        `视频上传失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 300)}`
      );
    }

    let result;
    try {
      result = JSON.parse(response.body);
    } catch {
      throw new Error(`视频上传响应解析失败: ${response.body.slice(0, 200)}`);
    }

    const videoId =
      result?.key ||
      result?.data?.video_id ||
      result?.data?.videoId ||
      result?.video_id ||
      result?.videoId ||
      result?.data?.key;

    if (!videoId) {
      throw new Error(
        `视频上传响应中未找到 video_id/key: ${JSON.stringify(result).slice(0, 200)}`
      );
    }

    return videoId;
  }

  // 分块上传（>4MB）
  const chunkUploadId = uploadId || `upload_${Date.now()}`;
  let videoKey = null;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    const chunkBuffer = videoBuffer.slice(start, end);

    process.stdout.write(
      `   [${chunkIndex + 1}/${totalChunks}] 上传分块 ${(chunkBuffer.length / 1024).toFixed(0)}KB... `
    );

    const boundary = `----KuaishouChunkBoundary${Date.now().toString(16)}`;
    const CRLF = '\r\n';

    const chunkFields = {
      token: uploadToken,
      upload_id: chunkUploadId,
      chunk_index: String(chunkIndex),
      chunks: String(totalChunks),
    };
    if (tokenKey) {
      chunkFields.key = tokenKey.replace('{filename}', filename);
    }

    const parts = [];
    for (const [name, value] of Object.entries(chunkFields)) {
      parts.push(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
          `${value}${CRLF}`
      );
    }
    const fileHeader =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`;
    const fileFooter = `${CRLF}--${boundary}--${CRLF}`;

    const chunkBody = Buffer.concat([
      Buffer.from(parts.join('')),
      Buffer.from(fileHeader),
      chunkBuffer,
      Buffer.from(fileFooter),
    ]);

    const response = await withRetry(
      () =>
        httpRequest(
          uploadEndpoint,
          'POST',
          chunkBody,
          Object.assign({}, baseHeaders, {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          }),
          60000
        ),
      3,
      3000,
      err => !err.message.includes('SESSION_EXPIRED')
    );

    if (response.statusCode !== 200 && response.statusCode !== 201) {
      throw new Error(
        `分块 ${chunkIndex + 1} 上传失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 300)}`
      );
    }

    let chunkResult;
    try {
      chunkResult = JSON.parse(response.body);
    } catch {
      throw new Error(`分块响应解析失败: ${response.body.slice(0, 200)}`);
    }

    if (chunkIndex === totalChunks - 1) {
      videoKey =
        chunkResult?.key ||
        chunkResult?.data?.video_id ||
        chunkResult?.data?.videoId ||
        chunkResult?.data?.key;
    }

    console.log('✅');
  }

  // 分块上传完成通知
  const completePayload = JSON.stringify({
    token: uploadToken,
    upload_id: chunkUploadId,
    chunks: totalChunks,
    ...(tokenKey ? { key: tokenKey.replace('{filename}', filename) } : {}),
  });

  const completeResponse = await withRetry(
    () =>
      httpRequest(
        KUAISHOU_VIDEO_COMPLETE_URL,
        'POST',
        completePayload,
        Object.assign({}, baseHeaders, { 'Content-Type': 'application/json' }),
        30000
      ),
    3,
    2000
  );

  if (completeResponse.statusCode === 200 || completeResponse.statusCode === 201) {
    try {
      const completeResult = JSON.parse(completeResponse.body);
      videoKey =
        videoKey ||
        completeResult?.key ||
        completeResult?.data?.video_id ||
        completeResult?.data?.key;
    } catch {
      // 无法解析，保留已有 videoKey
    }
  }

  if (!videoKey) {
    videoKey = chunkUploadId;
    console.log(`   ⚠️  未能从响应提取 video_id，使用 upload_id: ${videoKey}`);
  }

  return videoKey;
}

/**
 * 上传封面图
 *
 * @param {string} coverPath - 封面图路径
 * @param {string} cookieHeader - Cookie Header
 * @returns {Promise<string>} 封面图 ID
 */
async function uploadCoverImage(coverPath, cookieHeader) {
  const baseHeaders = {
    Cookie: cookieHeader,
    'Content-Type': 'application/json',
    Referer: 'https://cp.kuaishou.com/',
    Origin: 'https://cp.kuaishou.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json, text/plain, */*',
  };

  const tokenResponse = await withRetry(
    () => httpRequest(KUAISHOU_COVER_UPLOAD_TOKEN_URL, 'POST', JSON.stringify({}), baseHeaders),
    3,
    2000,
    err => !err.message.includes('SESSION_EXPIRED')
  );

  if (isLoginError(tokenResponse.statusCode, tokenResponse.body)) {
    throw new Error('[SESSION_EXPIRED] 会话失效：获取封面上传 Token 时收到登录错误');
  }
  if (tokenResponse.statusCode !== 200) {
    throw new Error(
      `获取封面上传 Token 失败 (HTTP ${tokenResponse.statusCode}): ${tokenResponse.body.slice(0, 200)}`
    );
  }

  const { ok: tokenOk, data: tokenData, errorMsg: tokenErr } = parseKuaishouResponse(tokenResponse.body);
  if (!tokenOk) throw new Error(`获取封面上传 Token 失败: ${tokenErr}`);

  const uploadToken = tokenData?.token || tokenData?.upload_token || tokenData?.uploadToken;
  const uploadEndpoint = tokenData?.endpoint || tokenData?.upload_url || 'https://up.qbox.me';
  const tokenKey = tokenData?.key || null;

  if (!uploadToken) {
    throw new Error(`封面上传 Token 响应中未找到 token: ${JSON.stringify(tokenData).slice(0, 200)}`);
  }

  const imageBuffer = fs.readFileSync(coverPath);
  const filename = path.basename(coverPath);
  const boundary = `----KuaishouCoverBoundary${Date.now().toString(16)}`;

  const extraFields = Object.assign(
    { token: uploadToken },
    tokenKey ? { key: tokenKey.replace('{filename}', filename) } : {}
  );

  const formBody = buildImageUploadForm(imageBuffer, filename, boundary, extraFields);

  const uploadResponse = await withRetry(
    () =>
      httpRequest(
        uploadEndpoint,
        'POST',
        formBody,
        {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Cookie: cookieHeader,
          Referer: 'https://cp.kuaishou.com/',
          Origin: 'https://cp.kuaishou.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        60000
      ),
    3,
    2000
  );

  if (uploadResponse.statusCode !== 200 && uploadResponse.statusCode !== 201) {
    throw new Error(
      `封面上传失败 (HTTP ${uploadResponse.statusCode}): ${uploadResponse.body.slice(0, 200)}`
    );
  }

  let uploadResult;
  try {
    uploadResult = JSON.parse(uploadResponse.body);
  } catch {
    throw new Error(`封面上传响应解析失败: ${uploadResponse.body.slice(0, 200)}`);
  }

  const coverId =
    uploadResult?.key ||
    uploadResult?.data?.photo_id ||
    uploadResult?.data?.photoId ||
    uploadResult?.photo_id;

  if (!coverId) {
    throw new Error(`封面上传响应中未找到 photo_id/key: ${JSON.stringify(uploadResult).slice(0, 200)}`);
  }

  return coverId;
}

/**
 * 发布视频
 *
 * @param {Object} opts
 * @param {string} opts.title - 视频标题
 * @param {string[]} opts.tags - 标签数组
 * @param {string} opts.videoId - 视频 ID/key
 * @param {string|null} opts.coverId - 封面图 ID（可选）
 * @param {string} opts.cookieHeader - Cookie Header
 * @returns {Promise<{ workId: string|null, workUrl: string|null }>}
 */
async function publishVideo({ title, tags, videoId, coverId, cookieHeader }) {
  const tagsStr = tags.length > 0 ? tags.map(t => `#${t}`).join(' ') : '';
  const caption = tagsStr ? `${title}\n${tagsStr}` : title;

  const payload = {
    caption,
    title,
    type: 'video',
    video_id: videoId,
    photo_type: 'video',
    ...(coverId ? { cover_id: coverId, cover_photo_id: coverId } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };

  const headers = {
    Cookie: cookieHeader,
    'Content-Type': 'application/json',
    Referer: 'https://cp.kuaishou.com/',
    Origin: 'https://cp.kuaishou.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json, text/plain, */*',
  };

  const response = await withRetry(
    () => httpRequest(KUAISHOU_VIDEO_PUBLISH_URL, 'POST', JSON.stringify(payload), headers),
    3,
    2000,
    err => !err.message.includes('SESSION_EXPIRED') && !err.message.includes('会话失效')
  );

  if (isLoginError(response.statusCode, response.body)) {
    throw new Error('[SESSION_EXPIRED] 会话失效：发布接口收到登录错误');
  }
  if (isRateLimit(response.body)) {
    throw new Error('快手限频：发布太频繁，请稍后重试');
  }
  if (response.statusCode === 404) {
    throw new Error(
      `发布接口返回 404，端点可能已变更。\n` +
        `当前端点: ${KUAISHOU_VIDEO_PUBLISH_URL}\n` +
        `排查：在 Windows Chrome 打开快手 CP，发布视频时记录 Network 中发布请求 URL`
    );
  }
  if (response.statusCode !== 200) {
    throw new Error(`发布失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 300)}`);
  }

  const { ok, data, errorMsg } = parseKuaishouResponse(response.body);
  if (!ok) throw new Error(`发布 API 错误: ${errorMsg}`);

  const workId =
    data?.photo_id || data?.photoId || data?.work_id || data?.workId ||
    data?.video_id || data?.videoId || data?.id;

  return {
    workId: workId || null,
    workUrl: workId
      ? `https://cp.kuaishou.com/article/manage/video?photoId=${workId}`
      : null,
  };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const { video, title, tags, cover } = parseArgs(process.argv);

  if (!video) {
    console.error('❌ 错误：必须提供视频文件路径（--video）');
    console.error('使用方式：node publish-kuaishou-video.cjs --video /path/to/video.mp4 --title "标题" [--tags "标签1,标签2"] [--cover /path/to/cover.jpg]');
    process.exit(1);
  }

  if (!title) {
    console.error('❌ 错误：必须提供视频标题（--title）');
    console.error('使用方式：node publish-kuaishou-video.cjs --video /path/to/video.mp4 --title "标题"');
    process.exit(1);
  }

  if (!fs.existsSync(video)) {
    console.error(`❌ 错误：视频文件不存在: ${video}`);
    process.exit(1);
  }

  if (cover && !fs.existsSync(cover)) {
    console.error(`❌ 错误：封面图文件不存在: ${cover}`);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('快手视频发布');
  console.log('========================================\n');
  console.log(`🎬 视频文件: ${video}`);
  console.log(`📝 标题: ${title}`);
  if (tags.length > 0) console.log(`🏷️  标签: ${tags.join(', ')}`);
  if (cover) console.log(`🖼️  封面图: ${cover}`);
  console.log('');

  let cdp;

  try {
    console.log('1️⃣  连接 CDP 提取会话 Cookie...\n');
    const pagesData = await getCDPPages(WINDOWS_IP, CDP_PORT);
    const kuaishouPage = pagesData.find(
      p => p.type === 'page' && p.url.includes('kuaishou.com')
    );
    const targetPage = kuaishouPage || pagesData.find(p => p.type === 'page');
    if (!targetPage) throw new Error('未找到任何浏览器页面');
    if (!kuaishouPage) console.log(`   ⚠️  未找到快手页面，使用: ${targetPage.url}`);

    cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
    await cdp.connect();
    console.log('   ✅ CDP 已连接\n');

    const { cookieHeader } = await extractKuaishouSession(cdp);
    console.log('   ✅ 会话 Cookie 已提取\n');

    console.log('2️⃣  获取视频上传 Token...\n');
    const tokenInfo = await getVideoUploadToken(cookieHeader);
    console.log(`   ✅ 上传 Token 已获取，端点: ${tokenInfo.uploadEndpoint}\n`);

    console.log('3️⃣  上传视频文件...\n');
    const videoId = await uploadVideo(video, cookieHeader, tokenInfo);
    console.log(`\n   ✅ 视频上传完成，ID: ${videoId}\n`);

    let coverId = null;
    if (cover) {
      console.log('4️⃣  上传封面图...\n');
      coverId = await uploadCoverImage(cover, cookieHeader);
      console.log(`   ✅ 封面图上传完成，ID: ${coverId}\n`);
    }

    console.log('5️⃣  发布视频...\n');
    const { workId, workUrl } = await publishVideo({
      title,
      tags,
      videoId,
      coverId,
      cookieHeader,
    });

    console.log('\n✅ 快手视频发布成功！');
    if (workId) console.log(`   作品 ID: ${workId}`);
    if (workUrl) console.log(`   管理链接: ${workUrl}`);
  } catch (err) {
    const isSessError = err.message.includes('[SESSION_EXPIRED]');
    console.error(`\n${isSessError ? '[SESSION_EXPIRED]' : '❌'} 发布失败: ${err.message}`);
    process.exit(isSessError ? 2 : 1);
  } finally {
    if (cdp) cdp.close();
  }
}

if (require.main === module) {
  main();
}

// 导出纯函数供单元测试使用
module.exports = {
  parseCookieHeader,
  isSessionValid,
  isLoginError,
  isRateLimit,
  parseKuaishouResponse,
  parseArgs,
  buildImageUploadForm,
};
