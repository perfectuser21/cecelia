/**
 * golden-path-legacy.js — golden_path（L4 step 旧表，迁移 303）退役闸。
 *
 * 真身已换：步骤 = steps（迁移 492）、格子 = journey_step_links、探针 = step_probes（迁移 496）。
 * 旧表不 DROP 不 RENAME、行数原样（退役注释见迁移 496）；本闸只管代码路径：
 *   - 写路径（POST/PATCH /golden_path、promote 覆盖写）一律 410，永不放行
 *   - 读路径默认 410；GOLDEN_PATH_LEGACY_READ=1 时放行（应急回看窗口，只认字面 "1"）
 * 任务 7d312fd8；决策 3e867cad / f425e3fd。
 */

export const GOLDEN_PATH_LEGACY_READ_ENV = 'GOLDEN_PATH_LEGACY_READ';

export const GOLDEN_PATH_RETIRED_HINT =
  '旧表 golden_path 已退役：步骤真身 GET /api/brain/steps，格子/探针见 journey_step_links + step_probes（任务 7d312fd8）';

/** 应急放行窗口是否打开（只认字面 "1"）。 */
export function legacyReadEnabled(env = process.env) {
  return env[GOLDEN_PATH_LEGACY_READ_ENV] === '1';
}

/** 410 响应体；写路径不给放行 env 名（写永远不放行）。 */
export function goldenPathRetiredBody({ write = false } = {}) {
  const body = {
    error: 'golden_path retired',
    retired: true,
    path_kind: write ? 'write' : 'read',
    hint: GOLDEN_PATH_RETIRED_HINT,
  };
  if (!write) body.legacy_read_env = `${GOLDEN_PATH_LEGACY_READ_ENV}=1`;
  return body;
}

export function sendGoldenPathRetired(res, opts) {
  return res.status(410).json(goldenPathRetiredBody(opts));
}

/**
 * 读路由守门：flag 关 → 发 410 并返回 true（调用方应立即 return）；flag 开 → false。
 */
export function guardLegacyRead(res, env = process.env) {
  if (legacyReadEnabled(env)) return false;
  sendGoldenPathRetired(res, { write: false });
  return true;
}
