/**
 * kr3-config-checker.js
 *
 * KR3 微信小程序上线前置配置状态检测。
 *
 * 检测两个阻断项：
 * 1. WX_PAY_* 商户号配置（需在微信云控制台配置 4 个环境变量）
 * 2. Brain DB 管理员 OpenID 是否已初始化（miniapp bootstrapAdmin 是否调用过）
 *
 * 注意：WX_PAY_* 是 miniapp 云函数侧的环境变量，Brain 本身无法直接读取。
 * 通过 Brain DB 中 `decisions` 表或 `key_results` 表记录的配置就绪标记来判断。
 *
 * 自动检测：readLocalPayCredentials() 读取 ~/.credentials/wechat-pay.env
 * 若 MCHID/V3_KEY/SERIAL_NO 已填入，autoMarkKR3IfLocalCredentialsReady() 自动标记 DB。
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** Brain DB 中的 decision key — WX_PAY 配置就绪标志 */
const WX_PAY_READY_KEY = 'kr3_wx_pay_configured';

/** Brain DB 中的 decision key — 管理员 OpenID 就绪标志 */
const ADMIN_OID_READY_KEY = 'kr3_admin_oid_initialized';

/** 本地凭据文件路径 */
const LOCAL_PAY_ENV_PATH = join(homedir(), '.credentials', 'wechat-pay.env');

/**
 * 读取本地 ~/.credentials/wechat-pay.env，返回支付商户号配置状态。
 * 不暴露实际值，只返回各字段是否已填写（非空）。
 *
 * @returns {{
 *   fileExists: boolean,
 *   mchidPresent: boolean,
 *   v3KeyPresent: boolean,
 *   serialNoPresent: boolean,
 *   privateKeyPresent: boolean,
 *   allCredentialsReady: boolean,
 * }}
 */
export function readLocalPayCredentials() {
  if (!existsSync(LOCAL_PAY_ENV_PATH)) {
    return {
      fileExists: false,
      mchidPresent: false,
      v3KeyPresent: false,
      serialNoPresent: false,
      privateKeyPresent: false,
      allCredentialsReady: false,
    };
  }

  const lines = readFileSync(LOCAL_PAY_ENV_PATH, 'utf8').split('\n');
  const parsed = {};
  for (const line of lines) {
    const m = line.match(/^([^#\s][^=]*)=(.+)/);
    if (m) parsed[m[1].trim()] = m[2].trim();
  }

  const mchidPresent = !!parsed['WX_PAY_MCHID'];
  const v3KeyPresent = !!parsed['WX_PAY_V3_KEY'];
  const serialNoPresent = !!parsed['WX_PAY_SERIAL_NO'];
  const privateKeyPresent = !!parsed['WX_PAY_PRIVATE_KEY'];

  return {
    fileExists: true,
    mchidPresent,
    v3KeyPresent,
    serialNoPresent,
    privateKeyPresent,
    allCredentialsReady: mchidPresent && v3KeyPresent && serialNoPresent && privateKeyPresent,
  };
}

/**
 * 若本地凭据文件中支付配置齐全，且 DB 中尚未标记为就绪，则自动写入标记。
 * 幂等：若 DB 中已有 active 记录，跳过插入。
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<{ autoMarked: boolean, reason: string }>}
 */
export async function autoMarkKR3IfLocalCredentialsReady(dbPool) {
  const creds = readLocalPayCredentials();
  if (!creds.allCredentialsReady) {
    const missing = [];
    if (!creds.mchidPresent) missing.push('WX_PAY_MCHID');
    if (!creds.v3KeyPresent) missing.push('WX_PAY_V3_KEY');
    if (!creds.serialNoPresent) missing.push('WX_PAY_SERIAL_NO');
    if (!creds.privateKeyPresent) missing.push('WX_PAY_PRIVATE_KEY');
    return { autoMarked: false, reason: `本地凭据不完整，缺少: ${missing.join(', ')}` };
  }

  if (!dbPool) dbPool = (await import('./db.js')).default;

  // 幂等检查：DB 中是否已有 active 记录
  const { rows } = await dbPool.query(
    `SELECT id FROM decisions WHERE topic = $1 AND status = 'active' LIMIT 1`,
    [WX_PAY_READY_KEY]
  );
  if (rows.length > 0) {
    return { autoMarked: false, reason: 'DB 中已有就绪标记，跳过' };
  }

  // 自动标记
  await dbPool.query(
    `INSERT INTO decisions (topic, decision, category, status, made_by, created_at, updated_at)
     VALUES ($1, $2, 'kr3-config', 'active', 'system', NOW(), NOW())`,
    [WX_PAY_READY_KEY, '本地凭据文件自动检测：MCHID/V3_KEY/SERIAL_NO/PRIVATE_KEY 均已填写']
  );
  return { autoMarked: true, reason: '本地凭据完整，已自动标记 kr3_wx_pay_configured' };
}

/**
 * 检测 KR3 上线前置配置状态（纯内存版，不访问 DB）。
 *
 * 优先读取本地 ~/.credentials/wechat-pay.env；
 * 若文件中凭据齐全，则视为已配置。
 * 也兼容读取 Brain 进程内的环境变量（正确的 miniapp 命名）。
 *
 * @returns {{ wxPayConfigured: boolean, adminOidReady: boolean, summary: string, localFileCheck: object }}
 */
export function checkKR3Config() {
  // 优先：本地凭据文件检测（最准确）
  const localCreds = readLocalPayCredentials();

  // 备用：Brain 进程内环境变量（使用 miniapp 实际变量名）
  const envConfigured = !!(
    process.env.WX_PAY_MCHID &&
    process.env.WX_PAY_V3_KEY &&
    process.env.WX_PAY_SERIAL_NO
  );

  const wxPayConfigured = localCreds.allCredentialsReady || envConfigured;

  // admin OpenID ready: 进程层面无法直接检测，默认 false（需通过 DB 检查）
  const adminOidReady = false;

  const parts = [];
  if (wxPayConfigured) parts.push('WX_PAY ✅');
  else {
    const missing = [];
    if (!localCreds.mchidPresent) missing.push('MCHID');
    if (!localCreds.v3KeyPresent) missing.push('V3_KEY');
    if (!localCreds.serialNoPresent) missing.push('SERIAL_NO');
    parts.push(`WX_PAY ❌ (待配置: ${missing.join('/')})`);
  }
  parts.push('AdminOID ⏳ (需 DB 查询)');

  return {
    wxPayConfigured,
    adminOidReady,
    summary: parts.join(' | '),
    localFileCheck: localCreds,
  };
}

/**
 * 检测 KR3 上线前置配置状态（DB 版）。
 *
 * 查询 Brain DB 中的 decisions 表，判断：
 * 1. WX_PAY 商户号是否已由人工或自动检测标记为配置完成
 * 2. 管理员 OpenID 是否已初始化（bootstrapAdmin 调用过）
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<{
 *   wxPayConfigured: boolean,
 *   adminOidReady: boolean,
 *   wxPayNote: string|null,
 *   adminOidNote: string|null,
 *   summary: string,
 *   checkedAt: string,
 *   localCredentials: object,
 * }>}
 */
export async function checkKR3ConfigDB(dbPool) {
  if (!dbPool) {
    dbPool = (await import('./db.js')).default;
  }
  const checkedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const localCredentials = readLocalPayCredentials();

  try {
    const { rows } = await dbPool.query(
      `SELECT topic, decision, updated_at
       FROM decisions
       WHERE topic = ANY($1) AND status = 'active'`,
      [[WX_PAY_READY_KEY, ADMIN_OID_READY_KEY]]
    );

    const byKey = Object.fromEntries(rows.map(r => [r.topic, r]));

    const wxPayRow = byKey[WX_PAY_READY_KEY];
    const adminOidRow = byKey[ADMIN_OID_READY_KEY];

    const wxPayConfigured = !!wxPayRow;
    const adminOidReady = !!adminOidRow;

    const parts = [];
    if (wxPayConfigured) parts.push(`WX_PAY ✅ (${wxPayRow.updated_at?.toISOString?.()?.slice(0, 10)})`);
    else parts.push('WX_PAY ❌ 未配置');
    if (adminOidReady) parts.push(`AdminOID ✅ (${adminOidRow.updated_at?.toISOString?.()?.slice(0, 10)})`);
    else parts.push('AdminOID ❌ bootstrapAdmin 未调用');

    return {
      wxPayConfigured,
      adminOidReady,
      wxPayNote: wxPayRow?.decision || null,
      adminOidNote: adminOidRow?.decision || null,
      summary: parts.join(' | '),
      checkedAt,
      localCredentials,
    };
  } catch (err) {
    return {
      wxPayConfigured: false,
      adminOidReady: false,
      wxPayNote: null,
      adminOidNote: null,
      summary: `检测失败: ${err.message}`,
      checkedAt,
      localCredentials,
    };
  }
}

/**
 * 标记 WX_PAY 配置已完成（人工或自动调用）。
 *
 * @param {import('pg').Pool} [dbPool]
 * @param {string} [note] - 备注（如商户号后4位）
 */
export async function markWxPayConfigured(dbPool, note = '已配置') {
  if (!dbPool) dbPool = (await import('./db.js')).default;
  await dbPool.query(
    `UPDATE decisions SET status = 'superseded', updated_at = NOW()
     WHERE topic = $1 AND category = 'kr3-config' AND status = 'active'`,
    [WX_PAY_READY_KEY]
  );
  await dbPool.query(
    `INSERT INTO decisions (topic, decision, category, status, made_by, created_at, updated_at)
     VALUES ($1, $2, 'kr3-config', 'active', 'system', NOW(), NOW())`,
    [WX_PAY_READY_KEY, note]
  );
}

/**
 * 标记管理员 OpenID 已初始化（bootstrapAdmin 调用成功后写入）。
 *
 * @param {import('pg').Pool} [dbPool]
 * @param {string} [note] - 备注（如 OpenID 前4位）
 */
export async function markAdminOidInitialized(dbPool, note = '已初始化') {
  if (!dbPool) dbPool = (await import('./db.js')).default;
  await dbPool.query(
    `UPDATE decisions SET status = 'superseded', updated_at = NOW()
     WHERE topic = $1 AND category = 'kr3-config' AND status = 'active'`,
    [ADMIN_OID_READY_KEY]
  );
  await dbPool.query(
    `INSERT INTO decisions (topic, decision, category, status, made_by, created_at, updated_at)
     VALUES ($1, $2, 'kr3-config', 'active', 'system', NOW(), NOW())`,
    [ADMIN_OID_READY_KEY, note]
  );
}

/**
 * 通用 KR3 里程碑标记（upsert active decision）。
 * 用于 kr3-progress-calculator 定义的 6 个进度里程碑。
 *
 * @param {import('pg').Pool} [dbPool]
 * @param {string} topic - decisions.topic（见 KR3_MILESTONE_KEYS）
 * @param {string} [note]
 */
export async function markKR3Milestone(dbPool, topic, note = '已完成') {
  if (!dbPool) dbPool = (await import('./db.js')).default;
  await dbPool.query(
    `UPDATE decisions SET status = 'superseded', updated_at = NOW()
     WHERE topic = $1 AND category = 'kr3-milestone' AND status = 'active'`,
    [topic]
  );
  await dbPool.query(
    `INSERT INTO decisions (topic, decision, category, status, made_by, created_at, updated_at)
     VALUES ($1, $2, 'kr3-milestone', 'active', 'system', NOW(), NOW())`,
    [topic, note]
  );
}
