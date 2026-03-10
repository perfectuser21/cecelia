#!/usr/bin/env node
/**
 * 快手 Open Platform OAuth 2.0 客户端
 *
 * 功能：
 *   - Token 读取/存储/过期检测/自动刷新
 *   - 凭据缺失时 graceful degradation（清晰错误提示）
 *
 * 用法（CLI）：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node kuaishou-oauth-client.cjs check          # 检查 token 状态
 *   node kuaishou-oauth-client.cjs get-token        # 获取有效 access_token
 *   node kuaishou-oauth-client.cjs gen-auth-url     # 生成 OAuth 授权 URL
 *   node kuaishou-oauth-client.cjs exchange-code <code>  # 用 code 换 token
 *
 * 环境要求：
 *   ~/.credentials/kuaishou.env
 *
 * 退出码：
 *   0 - 操作成功
 *   1 - 凭据缺失/操作失败
 *   2 - Refresh token 已过期，需要重新授权
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const CREDENTIALS_FILE = path.join(os.homedir(), '.credentials', 'kuaishou.env');
const KUAISHOU_API_HOST = 'open.kuaishou.com';
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 分钟提前刷新

// ========== 凭据读取 ==========

/**
 * 加载凭据文件（如不存在则返回空对象）
 */
function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return {};
  }
  const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
  const creds = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    creds[key] = val;
  }
  return creds;
}

/**
 * 获取并校验必需凭据
 * @throws {Error} 当 APP_KEY 或 APP_SECRET 缺失时
 */
function getCredentials() {
  const creds = loadCredentials();

  const appKey = creds.KUAISHOU_APP_KEY;
  const appSecret = creds.KUAISHOU_APP_SECRET;

  if (!appKey || !appSecret) {
    const missing = [];
    if (!appKey) missing.push('KUAISHOU_APP_KEY');
    if (!appSecret) missing.push('KUAISHOU_APP_SECRET');

    throw new Error(
      `[KUAISHOU_MISSING_CREDENTIALS] 缺少必需凭据: ${missing.join(', ')}\n` +
      `\n凭据文件位置: ${CREDENTIALS_FILE}\n` +
      `\n请按以下步骤操作：\n` +
      `  1. 在快手开放平台 (open.kuaishou.com) 创建应用，获取 AppKey / AppSecret\n` +
      `  2. 将以下内容写入 ${CREDENTIALS_FILE}:\n` +
      `\n     KUAISHOU_APP_KEY=<your_app_key>\n` +
      `     KUAISHOU_APP_SECRET=<your_app_secret>\n` +
      `\n  3. 运行: node kuaishou-oauth-client.cjs gen-auth-url\n` +
      `  4. 打开授权 URL，完成授权，获得 code\n` +
      `  5. 运行: node kuaishou-oauth-client.cjs exchange-code <code>`
    );
  }

  return {
    appKey,
    appSecret,
    accessToken: creds.KUAISHOU_ACCESS_TOKEN || null,
    refreshToken: creds.KUAISHOU_REFRESH_TOKEN || null,
    tokenExpiresAt: creds.KUAISHOU_TOKEN_EXPIRES_AT
      ? parseInt(creds.KUAISHOU_TOKEN_EXPIRES_AT, 10)
      : null,
    openId: creds.KUAISHOU_OPEN_ID || null,
  };
}

// ========== Token 状态 ==========

/**
 * 检查 access_token 是否已过期（含提前缓冲）
 */
function isTokenExpired(expiresAt) {
  if (!expiresAt) return true;
  return Date.now() + TOKEN_EXPIRY_BUFFER_MS >= expiresAt * 1000;
}

// ========== 凭据存储 ==========

/**
 * 将 token 数据追加/更新到凭据文件（保留 APP_KEY / APP_SECRET）
 */
function saveTokens(tokenData) {
  const { accessToken, refreshToken, expiresIn, openId } = tokenData;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  // 读取现有凭据（保留 APP_KEY / APP_SECRET）
  const existing = loadCredentials();

  const lines = [];
  lines.push(`KUAISHOU_APP_KEY=${existing.KUAISHOU_APP_KEY || ''}`);
  lines.push(`KUAISHOU_APP_SECRET=${existing.KUAISHOU_APP_SECRET || ''}`);
  lines.push(`KUAISHOU_ACCESS_TOKEN=${accessToken}`);
  lines.push(`KUAISHOU_REFRESH_TOKEN=${refreshToken}`);
  lines.push(`KUAISHOU_TOKEN_EXPIRES_AT=${expiresAt}`);
  if (openId) {
    lines.push(`KUAISHOU_OPEN_ID=${openId}`);
  } else if (existing.KUAISHOU_OPEN_ID) {
    lines.push(`KUAISHOU_OPEN_ID=${existing.KUAISHOU_OPEN_ID}`);
  }

  const dir = path.dirname(CREDENTIALS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_FILE, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`[TOKEN_SAVED] Token 已保存到 ${CREDENTIALS_FILE}`);
}

// ========== HTTP 工具 ==========

/**
 * 发起 HTTPS POST 请求（JSON body）
 */
function httpsPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: KUAISHOU_API_HOST,
      port: 443,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON 解析失败: ${e.message} | 原始响应: ${data}`));
        }
      });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('请求超时 (15s)'));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ========== Token 刷新 ==========

/**
 * 用 refresh_token 换取新的 access_token
 * @throws {Error} 当 refresh_token 过期或无效时（exitCode=2）
 */
async function refreshAccessToken(creds) {
  if (!creds.refreshToken) {
    const err = new Error(
      '[KUAISHOU_REAUTH_REQUIRED] 缺少 refresh_token，需要重新授权\n' +
      `请运行: node kuaishou-oauth-client.cjs gen-auth-url`
    );
    err.exitCode = 2;
    throw err;
  }

  console.log('[TOKEN_REFRESH] 正在刷新 access_token...');
  const resp = await httpsPost('/oauth2/refresh_token', {
    app_id: creds.appKey,
    app_secret: creds.appSecret,
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
  });

  if (resp.result !== 1 || !resp.access_token) {
    const errMsg = resp.error_msg || JSON.stringify(resp);
    if (
      errMsg.includes('refresh_token') &&
      (errMsg.includes('expired') || errMsg.includes('invalid') || resp.result === 110)
    ) {
      const err = new Error(
        `[KUAISHOU_REAUTH_REQUIRED] Refresh token 已过期，需要重新授权\n` +
        `请运行: node kuaishou-oauth-client.cjs gen-auth-url\n` +
        `错误详情: ${errMsg}`
      );
      err.exitCode = 2;
      throw err;
    }
    throw new Error(`[KUAISHOU_REFRESH_FAILED] 刷新失败: ${errMsg}`);
  }

  saveTokens({
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token || creds.refreshToken,
    expiresIn: resp.expires_in || 86400,
    openId: resp.open_id || creds.openId,
  });

  console.log('[TOKEN_REFRESH] access_token 刷新成功');
  return resp.access_token;
}

// ========== 获取有效 Token ==========

/**
 * 返回一个有效的 access_token（如需要则自动刷新）
 */
async function getValidAccessToken() {
  const creds = getCredentials();

  if (!creds.accessToken) {
    const err = new Error(
      '[KUAISHOU_NO_TOKEN] 尚未获取 access_token\n' +
      `请运行:\n` +
      `  1. node kuaishou-oauth-client.cjs gen-auth-url\n` +
      `  2. node kuaishou-oauth-client.cjs exchange-code <code>`
    );
    err.exitCode = 1;
    throw err;
  }

  if (isTokenExpired(creds.tokenExpiresAt)) {
    return await refreshAccessToken(creds);
  }

  return creds.accessToken;
}

// ========== OAuth 授权 ==========

/**
 * 生成 OAuth 授权 URL
 * @param {Object} options
 * @param {string} [options.redirectUri='oob'] - 回调 URI（不填则用 oob）
 * @param {string} [options.scope] - 权限范围，默认 photo.publish
 * @param {string} [options.state] - 随机状态字符串（防 CSRF）
 */
function generateAuthUrl(options = {}) {
  const creds = getCredentials();
  const {
    redirectUri = 'oob',
    scope = 'photo.publish',
    state = Math.random().toString(36).slice(2),
  } = options;

  const params = new URLSearchParams({
    app_id: creds.appKey,
    scope,
    response_type: 'code',
    ua: 'pc',
    redirect_uri: redirectUri,
    state,
  });

  return `https://${KUAISHOU_API_HOST}/oauth2/authorize?${params.toString()}`;
}

/**
 * 用 authorization_code 换取 access_token + refresh_token
 * @param {Object} options
 * @param {string} options.code - 授权码
 * @param {string} [options.redirectUri='oob']
 */
async function exchangeCodeForToken(options) {
  const { code, redirectUri = 'oob' } = options;
  if (!code) throw new Error('需要提供 authorization_code');

  const creds = getCredentials();

  const resp = await httpsPost('/oauth2/access_token', {
    app_id: creds.appKey,
    app_secret: creds.appSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  if (resp.result !== 1 || !resp.access_token) {
    throw new Error(`[KUAISHOU_EXCHANGE_FAILED] 换取 token 失败: ${resp.error_msg || JSON.stringify(resp)}`);
  }

  saveTokens({
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    expiresIn: resp.expires_in || 86400,
    openId: resp.open_id,
  });

  console.log(`[TOKEN_SAVED] 授权成功！open_id: ${resp.open_id}`);
  return resp;
}

// ========== 导出 ==========

module.exports = {
  loadCredentials,
  getCredentials,
  isTokenExpired,
  saveTokens,
  refreshAccessToken,
  getValidAccessToken,
  generateAuthUrl,
  exchangeCodeForToken,
  httpsPost,
  KUAISHOU_API_HOST,
};

// ========== CLI 入口 ==========

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);

  async function run() {
    switch (cmd) {
      case 'check': {
        try {
          const creds = getCredentials();
          const expired = isTokenExpired(creds.tokenExpiresAt);
          const expiryStr = creds.tokenExpiresAt
            ? new Date(creds.tokenExpiresAt * 1000).toISOString()
            : '未知';
          console.log(`[SESSION_CHECK]`);
          console.log(`  APP_KEY    : ${creds.appKey ? '已配置 ✅' : '未配置 ❌'}`);
          console.log(`  APP_SECRET : ${creds.appSecret ? '已配置 ✅' : '未配置 ❌'}`);
          console.log(`  access_token: ${creds.accessToken ? '存在' : '缺失 ❌'}`);
          console.log(`  refresh_token: ${creds.refreshToken ? '存在' : '缺失 ❌'}`);
          console.log(`  token 过期时间: ${expiryStr}`);
          console.log(`  token 状态: ${expired ? '已过期 ❌（将自动刷新）' : '有效 ✅'}`);
          if (!creds.accessToken) {
            console.log('\n需要完成 OAuth 授权:');
            console.log('  1. node kuaishou-oauth-client.cjs gen-auth-url');
            console.log('  2. 浏览器打开 URL，完成授权，获得 code');
            console.log('  3. node kuaishou-oauth-client.cjs exchange-code <code>');
          }
        } catch (err) {
          console.error(err.message);
          process.exit(err.exitCode || 1);
        }
        break;
      }

      case 'get-token': {
        try {
          const token = await getValidAccessToken();
          console.log(`[ACCESS_TOKEN] ${token}`);
        } catch (err) {
          console.error(err.message);
          process.exit(err.exitCode || 1);
        }
        break;
      }

      case 'gen-auth-url': {
        try {
          const url = generateAuthUrl();
          console.log('[AUTH_URL] 请在浏览器中打开以下 URL 完成授权:\n');
          console.log(url);
          console.log('\n授权完成后，将获得 code，然后运行:');
          console.log('  node kuaishou-oauth-client.cjs exchange-code <code>');
        } catch (err) {
          console.error(err.message);
          process.exit(err.exitCode || 1);
        }
        break;
      }

      case 'exchange-code': {
        const code = rest[0];
        if (!code) {
          console.error('用法: node kuaishou-oauth-client.cjs exchange-code <authorization_code>');
          process.exit(1);
        }
        try {
          await exchangeCodeForToken({ code });
          console.log('\n✅ Token 获取成功！现在可以使用 API 发布功能。');
        } catch (err) {
          console.error(err.message);
          process.exit(err.exitCode || 1);
        }
        break;
      }

      default: {
        console.log(`快手 OAuth 客户端

用法:
  node kuaishou-oauth-client.cjs check               检查 token 状态
  node kuaishou-oauth-client.cjs get-token            获取有效 access_token（自动刷新）
  node kuaishou-oauth-client.cjs gen-auth-url         生成 OAuth 授权 URL
  node kuaishou-oauth-client.cjs exchange-code <code> 用授权码换取 token

凭据文件: ${CREDENTIALS_FILE}`);
        if (cmd) process.exit(1);
      }
    }
  }

  run().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
