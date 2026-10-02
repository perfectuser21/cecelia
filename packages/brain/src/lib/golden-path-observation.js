import { recordGoldenPathHttp } from './golden-path-audit-runtime.js';
import { legacyReadEnabled, sendGoldenPathRetired } from './golden-path-legacy.js';

// 只识别仍注册的旧入口，使用模板而非请求 URL，避免参数/正文/凭据进入事件账。
const routes = [
  ['read', /^\/golden_path\/?$/i, '/golden_path'],
  ['read', /^\/golden_path\/canvas\/?$/i, '/golden_path/canvas'],
  ['read', /^\/golden_path\/[^/]+\/decisions\/?$/i, '/golden_path/:id/decisions'],
  ['read', /^\/tasks\/[^/]+\/golden-path-decisions\/?$/i, '/tasks/:id/golden-path-decisions'],
  ['read', /^\/journeys\/[^/]+\/golden-paths\/?$/i, '/journeys/:journey_id/golden-paths'],
  ['write', /^\/golden_path\/?$/i, '/golden_path', 'POST'],
  ['write', /^\/golden_path\/[^/]+\/?$/i, '/golden_path/:id', 'PATCH'],
  ['write', /^\/golden_path\/[^/]+\/run-result\/?$/i, '/golden_path/:id/run-result', 'POST'],
];

function identify(req) {
  if (req.method === 'POST' && /^\/decisions\/?$/i.test(req.path)
      && req.body?.target_type === 'golden_path') return ['write', null, '/decisions'];
  return routes.find(([kind, pattern, , method]) => pattern.test(req.path)
    && (kind === 'read' ? ['GET', 'HEAD'].includes(req.method) : req.method === method));
}

/** 退役观察窗：每次入口命中先落既有事件账；失败不打开退役写口。 */
export async function observeGoldenPathLegacy(req, res, next, auditOptions = undefined) {
  const match = identify(req);
  if (!match) return next();
  const [kind, , route] = match;
  const enabled = legacyReadEnabled();
  const allowed = kind === 'read' && enabled;
  const audit = await recordGoldenPathHttp({ method: req.method, route, path_kind: kind, allowed }, auditOptions);
  if (!allowed || !audit.persisted) return sendGoldenPathRetired(res, { write: kind === 'write' });
  return next();
}
