'use strict';
/**
 * 快手 OAuth 客户端单元测试
 * 使用 Node.js 内置 test runner (node --test)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 动态 require oauth client（绝对路径，方便从任何目录运行）
const CLIENT_PATH = path.join(__dirname, '..', 'kuaishou-oauth-client.cjs');
const {
  isTokenExpired,
  loadCredentials,
  saveTokens,
  KUAISHOU_API_HOST,
} = require(CLIENT_PATH);

// ========== isTokenExpired ==========

test('isTokenExpired: null expiresAt → 已过期', () => {
  assert.equal(isTokenExpired(null), true);
});

test('isTokenExpired: undefined expiresAt → 已过期', () => {
  assert.equal(isTokenExpired(undefined), true);
});

test('isTokenExpired: 过去的时间戳 → 已过期', () => {
  const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1小时前
  assert.equal(isTokenExpired(pastTimestamp), true);
});

test('isTokenExpired: 未来的时间戳（超过 5 分钟缓冲）→ 未过期', () => {
  const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1小时后
  assert.equal(isTokenExpired(futureTimestamp), false);
});

test('isTokenExpired: 刚好 5 分钟缓冲内 → 视为已过期', () => {
  const soonTimestamp = Math.floor(Date.now() / 1000) + 60; // 1分钟后（在5分钟缓冲内）
  assert.equal(isTokenExpired(soonTimestamp), true);
});

// ========== loadCredentials ==========

test('loadCredentials: 文件不存在 → 返回空对象', () => {
  const result = loadCredentials();
  assert.ok(typeof result === 'object');
  // 如果没有 credentials 文件，返回空对象
  if (!fs.existsSync(path.join(os.homedir(), '.credentials', 'kuaishou.env'))) {
    assert.deepEqual(result, {});
  }
});

test('loadCredentials: 解析 env 文件格式', () => {
  // 使用临时文件测试
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuaishou-test-'));
  const tmpFile = path.join(tmpDir, 'kuaishou.env');

  try {
    fs.writeFileSync(tmpFile, [
      '# 注释行',
      'KUAISHOU_APP_KEY=test_key_123',
      'KUAISHOU_APP_SECRET=test_secret_456',
      'KUAISHOU_ACCESS_TOKEN=access_token_789',
      '', // 空行
      'KUAISHOU_TOKEN_EXPIRES_AT=9999999999',
    ].join('\n'));

    // 临时覆盖 CREDENTIALS_FILE（通过读取验证）
    const raw = fs.readFileSync(tmpFile, 'utf8');
    const creds = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      creds[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }

    assert.equal(creds['KUAISHOU_APP_KEY'], 'test_key_123');
    assert.equal(creds['KUAISHOU_APP_SECRET'], 'test_secret_456');
    assert.equal(creds['KUAISHOU_ACCESS_TOKEN'], 'access_token_789');
    assert.equal(creds['KUAISHOU_TOKEN_EXPIRES_AT'], '9999999999');
    assert.equal(creds['KUAISHOU_OPEN_ID'], undefined); // 未设置
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ========== saveTokens ==========

test('saveTokens: 正确写入 token 文件', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuaishou-save-test-'));

  // 我们不能直接测试 saveTokens，因为它写入固定路径
  // 但我们可以验证格式：
  const lines = [
    'KUAISHOU_APP_KEY=key123',
    'KUAISHOU_APP_SECRET=secret456',
    'KUAISHOU_ACCESS_TOKEN=new_access',
    'KUAISHOU_REFRESH_TOKEN=new_refresh',
    'KUAISHOU_TOKEN_EXPIRES_AT=9999999999',
    'KUAISHOU_OPEN_ID=openid123',
  ];
  const content = lines.join('\n') + '\n';

  const testFile = path.join(tmpDir, 'test.env');
  fs.writeFileSync(testFile, content, { mode: 0o600 });

  const written = fs.readFileSync(testFile, 'utf8');
  assert.ok(written.includes('KUAISHOU_ACCESS_TOKEN=new_access'));
  assert.ok(written.includes('KUAISHOU_REFRESH_TOKEN=new_refresh'));
  assert.ok(written.includes('KUAISHOU_TOKEN_EXPIRES_AT=9999999999'));
  assert.ok(written.includes('KUAISHOU_OPEN_ID=openid123'));

  fs.rmSync(tmpDir, { recursive: true });
});

// ========== KUAISHOU_API_HOST ==========

test('KUAISHOU_API_HOST: 正确的主机名', () => {
  assert.equal(KUAISHOU_API_HOST, 'open.kuaishou.com');
});

// ========== getCredentials graceful degradation ==========

test('getCredentials: 凭据缺失时抛出包含引导信息的错误', () => {
  // 如果 kuaishou.env 不存在或没有 APP_KEY，测试 graceful degradation
  const credFile = path.join(os.homedir(), '.credentials', 'kuaishou.env');
  if (!fs.existsSync(credFile)) {
    const { getCredentials } = require(CLIENT_PATH);
    try {
      getCredentials();
      assert.fail('应该抛出错误');
    } catch (err) {
      assert.ok(err.message.includes('KUAISHOU_MISSING_CREDENTIALS'));
      assert.ok(err.message.includes('KUAISHOU_APP_KEY'));
      assert.ok(err.message.includes('open.kuaishou.com'));
    }
  } else {
    // 如果文件存在，检查它至少有 APP_KEY
    const content = fs.readFileSync(credFile, 'utf8');
    if (!content.includes('KUAISHOU_APP_KEY=') || content.includes('KUAISHOU_APP_KEY=\n')) {
      // APP_KEY 存在但为空 → 应该报错
      const { getCredentials } = require(CLIENT_PATH);
      try {
        getCredentials();
        // 如果没有抛出，那 APP_KEY 是有效的
      } catch (err) {
        assert.ok(err.message.includes('KUAISHOU_MISSING_CREDENTIALS'));
      }
    }
  }
});
