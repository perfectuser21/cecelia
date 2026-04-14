/**
 * kr3-config-checker.js
 *
 * KR3 微信小程序上线前置配置状态检测。
 *
 * 检测两个阻断项：
 * 1. WX_PAY_* 环境变量（微信支付商户号配置，需人工在微信云控制台配置）
 * 2. Brain DB 管理员 OpenID 是否已初始化（miniapp bootstrapAdmin 是否调用过）
 *
 * 注意：WX_PAY_* 是 miniapp 云函数侧的环境变量，Brain 本身无法直接读取。
 * 通过 Brain DB 中 `decisions` 表或 `key_results` 表记录的配置就绪标记来判断。
 */

/**
 * WX_PAY 配置就绪标志 — Brain DB 中的 decision key。
 * 人工在微信云控制台配置完 5 个 WX_PAY 环境变量后，通过此 key 标记。
 */
const WX_PAY_READY_KEY = 'kr3_wx_pay_configured';

/**
 * 管理员 OpenID 就绪标志 — Brain DB 中的 decision key。
 * 调用 miniapp bootstrapAdmin 后写入此标记。
 */
const ADMIN_OID_READY_KEY = 'kr3_admin_oid_initialized';

/**
 * 检测 KR3 上线前置配置状态（纯内存版，不访问 DB）。
 *
 * 用于无 DB 连接的场景（如单元测试、路由健康检测初期）。
 * 仅通过 Brain 进程内环境变量判断（如果 Brain 运行在有支付环境的服务器上则适用）。
 *
 * @returns {{ wxPayConfigured: boolean, adminOidReady: boolean, summary: string }}
 */
export function checkKR3Config() {
  const wxPayConfigured = !!(
    process.env.WX_PAY_MCH_ID &&
    process.env.WX_PAY_API_KEY_V3 &&
    process.env.WX_PAY_APP_ID
  );

  // admin OpenID ready: 进程层面无法直接检测，默认 false（需通过 DB 检查）
  const adminOidReady = false;

  const parts = [];
  if (wxPayConfigured) parts.push('WX_PAY ✅');
  else parts.push('WX_PAY ❌ (待配置)');
  parts.push('AdminOID ⏳ (需 DB 查询)');

  return {
    wxPayConfigured,
    adminOidReady,
    summary: parts.join(' | '),
  };
}

/**
 * 检测 KR3 上线前置配置状态（DB 版）。
 *
 * 查询 Brain DB 中的 decisions 表，判断：
 * 1. WX_PAY 商户号是否已由人工标记为配置完成
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
 * }>}
 */
export async function checkKR3ConfigDB(dbPool) {
  if (!dbPool) {
    // 懒加载 pool，避免模块级依赖链在无 node_modules 环境下失败
    dbPool = (await import('./db.js')).default;
  }
  const checkedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

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
    };
  } catch (err) {
    return {
      wxPayConfigured: false,
      adminOidReady: false,
      wxPayNote: null,
      adminOidNote: null,
      summary: `检测失败: ${err.message}`,
      checkedAt,
    };
  }
}

/**
 * 标记 WX_PAY 配置已完成（人工调用）。
 *
 * 在微信云控制台配置完 5 个 WX_PAY_* 环境变量后，
 * 通过 Brain API 调用此函数写入标记，让 Brain 知道配置已就绪。
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
