/**
 * vocab-alias.js — 行业词汇 API 别名中间件（词汇决策 a340f100 第二阶段·纯增量）
 *
 * 新路径 → 既有路径的 URL 重写：旧端点原样保留，新端点零成本获得同一实现。
 * 挂载必须在业务 router 之前（server.js）。任务 7b550e31。
 */

// 前缀映射：/api/brain 之后的第一段
const ALIAS_MAP = new Map([
  ['/value-streams', '/journeys'],
  ['/capabilities', '/golden-paths'],
  ['/backbone-activities', '/journey_steps'],
  ['/features-registry', '/journey_features'],
  ['/acceptance-criteria', '/journey_step_links'],
  ['/work-items', '/advancement_items'],
]);

export default function vocabAlias(req, _res, next) {
  for (const [alias, real] of ALIAS_MAP) {
    if (req.url === alias || req.url.startsWith(alias + '/') || req.url.startsWith(alias + '?')) {
      req.url = real + req.url.slice(alias.length);
      break;
    }
  }
  next();
}

export { ALIAS_MAP };
