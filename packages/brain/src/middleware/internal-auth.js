/**
 * 内部鉴权中间件
 *
 * 为内部/跨服务调用（如 zenithjoy pipeline-worker → Cecelia Brain LLM）
 * 提供统一的 token 校验。
 *
 * 规则：
 *   - token 来源：env CECELIA_INTERNAL_TOKEN
 *   - env 未设置 → dev 友好放行（仅第一次请求告警一次）
 *   - env 设置 + 请求带对应 token（Authorization: Bearer <token> 或 X-Internal-Token）→ 放行
 *   - env 设置 + 请求缺 / 错 token → 401
 */

let _warnedOnceNoToken = false;

export function internalAuth(req, res, next) {
  const expected = process.env.CECELIA_INTERNAL_TOKEN;

  // dev 友好：env 未设置时放行，并首次告警
  if (!expected) {
    if (!_warnedOnceNoToken) {
      console.warn(
        '[internal-auth] CECELIA_INTERNAL_TOKEN 未设置，当前以 dev 模式放行所有请求。' +
        ' 生产部署前请设置 env 并在调用方附带 Authorization: Bearer <token> 或 X-Internal-Token。'
      );
      _warnedOnceNoToken = true;
    }
    return next();
  }

  // 提取 token（两种方式）
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const xToken = (req.headers['x-internal-token'] || '').toString().trim();
  const provided = bearerToken || xToken;

  if (!provided) {
    return res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'UNAUTHORIZED',
        message: '缺少 internal token（Authorization: Bearer <token> 或 X-Internal-Token）',
      },
    });
  }

  if (provided !== expected) {
    return res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'UNAUTHORIZED',
        message: 'internal token 无效',
      },
    });
  }

  next();
}

// 测试辅助：重置"首次告警"标记
export function _resetInternalAuthWarning() {
  _warnedOnceNoToken = false;
}

export default internalAuth;
