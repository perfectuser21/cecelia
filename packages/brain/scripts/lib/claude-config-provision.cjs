'use strict';
/*
 * claude-config-provision — 宿主 bridge 凭据只读消费 helper
 *
 * 背景：宿主 bridge（cecelia-bridge.cjs /llm-call）此前直接把 CLAUDE_CONFIG_DIR 指向权威账号
 * 目录 ~/.claude-account{N}，claude CLI 会按自身逻辑刷新并回写权威 .credentials.json，形成
 * 多写入者竞态（决策 4ce29c14：多刷新者迟早互相覆盖 → invalid_grant）。
 *
 * 本模块把容器路径（docker-executor :ro 挂载 + 可写副本）与 Codex 路径（credential-envelope/v1
 * 只读消费）已验证的「只读消费」模式补齐到宿主 bridge：按 attempt 从权威目录复制一份独立的临时
 * config dir，claude 只写副本，权威文件全程只被读取；attempt 结束清理副本。
 *
 * 导出：
 *   - resolveAuthoritativeConfigDir(accountId, homeDir) → string  权威账号目录路径
 *   - provisionConfigDir({ accountId, homeDir, tmpBase }) → { configDir, authoritativeDir }
 *   - cleanupConfigDir(configDir, { logger, rmImpl }) → boolean
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * 解析权威账号 config 目录。
 * accountId 缺省时默认 account1（对齐 bridge 现有默认账号行为）。
 * @param {string|undefined} accountId
 * @param {string|undefined} homeDir 缺省用 os.homedir()（受 HOME 影响，可测试）
 * @returns {string}
 */
function resolveAuthoritativeConfigDir(accountId, homeDir) {
  const home = homeDir || os.homedir();
  const acct = accountId || 'account1';
  return path.join(home, '.claude-' + acct);
}

/**
 * 按 attempt 从权威目录复制出一份独立临时 config dir（只读消费权威）。
 *
 * - 临时目录名含 pid + 时间戳 + 随机后缀，保证并发不撞目录。
 * - 复制走真实 fs（禁 mock 边：代码 ↔ 文件系统 config dir 用真 fs），权威文件只被读取。
 * - 临时目录创建失败（如 tmpBase 父路径是文件 → ENOTDIR）直接抛错，**不回退**到直接用权威目录
 *   （回退 = 重新引入回写风险，违反 INV-1）。
 *
 * @param {{accountId?: string, homeDir?: string, tmpBase?: string}} opts
 * @returns {{configDir: string, authoritativeDir: string}}
 */
function provisionConfigDir(opts = {}) {
  const { accountId, homeDir, tmpBase } = opts;
  const authoritativeDir = resolveAuthoritativeConfigDir(accountId, homeDir);
  const base = tmpBase || os.tmpdir();

  // 唯一前缀：pid + 时间戳 + 随机；mkdtempSync 再追加 6 位随机 → 并发绝不撞目录。
  // 若 base 不可承载（父路径是文件/不存在）→ mkdtempSync 抛 ENOTDIR/ENOENT，直接向上抛，不回退。
  const prefix = path.join(
    base,
    `cecelia-claude-cfg-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}-`
  );
  const configDir = fs.mkdtempSync(prefix);

  // 从权威目录复制凭据 + 相关 config 到临时副本（对齐容器 entrypoint.sh 既有复制做法）。
  // 只读源：cpSync 读取源、写入目标，源文件 mtime/内容不变。
  copyAuthoritativeInto(authoritativeDir, configDir);

  return { configDir, authoritativeDir };
}

/**
 * 把权威目录内容复制进临时 config dir。
 * 权威目录不存在时视为无凭据可拷（保持临时目录为空），交由 claude 自身报未登录，
 * 绝不因源缺失而回退到权威目录。
 */
function copyAuthoritativeInto(authoritativeDir, configDir) {
  if (!fs.existsSync(authoritativeDir)) return;
  // recursive 覆盖复制；configDir 已由 mkdtempSync 创建，cpSync 合并写入。
  fs.cpSync(authoritativeDir, configDir, { recursive: true, force: true, dereference: true });
}

/**
 * 清理临时 config dir。
 * 清理失败仅记日志、返回 false，**不抛错**、不影响主流程结果（失败语义：孤儿副本可后台 GC）。
 *
 * @param {string} configDir
 * @param {{logger?: object, rmImpl?: function}} opts
 *   - rmImpl：仅用于测试注入触发清理失败错误分支；缺省用真实 fs.rmSync。
 * @returns {boolean} 清理成功 true；失败 false（已记 warn）。
 */
function cleanupConfigDir(configDir, opts = {}) {
  const logger = opts.logger || console;
  const rmImpl = opts.rmImpl || ((p) => fs.rmSync(p, { recursive: true, force: true }));
  const warn = typeof logger.warn === 'function'
    ? logger.warn.bind(logger)
    : (typeof logger.log === 'function' ? logger.log.bind(logger) : console.warn);
  try {
    rmImpl(configDir);
    return true;
  } catch (err) {
    warn(`[claude-config-provision] cleanup failed for ${configDir}: ${err && err.message ? err.message : err}`);
    return false;
  }
}

module.exports = {
  resolveAuthoritativeConfigDir,
  provisionConfigDir,
  cleanupConfigDir,
};
