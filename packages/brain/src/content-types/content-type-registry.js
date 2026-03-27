/**
 * Content Type Registry
 * 内容类型注册表加载器 — DB 优先，YAML 兜底
 *
 * 优先级：content_type_configs 表 > YAML 文件
 * 新增内容类型：通过 API 写入 DB，或在 content-types/ 目录下添加 YAML 文件。
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import pool from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_TYPES_DIR = __dirname;

// 必填字段定义
const REQUIRED_FIELDS = ['content_type', 'images', 'template', 'review_rules', 'copy_rules'];

/**
 * 验证内容类型配置是否包含所有必填字段
 * @param {string} typeName - 类型名称（用于错误提示）
 * @param {object} config - 解析后的配置对象
 * @throws {Error} 缺少必填字段时抛出
 */
function validateConfig(typeName, config) {
  const missing = REQUIRED_FIELDS.filter((field) => !(field in config));
  if (missing.length > 0) {
    throw new Error(
      `内容类型 "${typeName}" 配置无效：缺少必填字段 [${missing.join(', ')}]`
    );
  }
  if (config.content_type !== typeName) {
    throw new Error(
      `内容类型 "${typeName}" 配置无效：content_type 字段值 "${config.content_type}" 与文件名不匹配`
    );
  }
}

/**
 * 从 YAML 文件加载指定内容类型配置（内部用，兜底逻辑）
 * @param {string} typeName - 内容类型名称
 * @returns {object|null} 配置对象或 null
 */
function getContentTypeFromYaml(typeName) {
  const yamlPath = join(CONTENT_TYPES_DIR, `${typeName}.yaml`);

  let rawContent;
  try {
    rawContent = readFileSync(yamlPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw new Error(`读取内容类型 "${typeName}" 失败：${err.message}`);
  }

  let config;
  try {
    config = yaml.load(rawContent);
  } catch (err) {
    throw new Error(`解析内容类型 "${typeName}" YAML 失败：${err.message}`);
  }

  validateConfig(typeName, config);
  return config;
}

/**
 * 从 YAML 目录列出所有内容类型名称（内部用）
 * @returns {string[]} 内容类型名称数组
 */
function listContentTypesFromYaml() {
  let files;
  try {
    files = readdirSync(CONTENT_TYPES_DIR);
  } catch (err) {
    throw new Error(`读取内容类型目录失败：${err.message}`);
  }

  return files
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => f.replace(/\.(yaml|yml)$/, ''));
}

/**
 * 加载并解析指定内容类型配置（DB 优先，YAML 兜底）
 * @param {string} typeName - 内容类型名称（如 "solo-company-case"）
 * @returns {object|null} 内容类型配置对象，类型不存在时返回 null
 * @throws {Error} 配置无效时抛出
 */
async function getContentType(typeName) {
  // 1. 先查 DB content_type_configs 表
  try {
    const result = await pool.query(
      'SELECT config FROM content_type_configs WHERE content_type = $1',
      [typeName]
    );
    if (result.rows.length > 0) {
      const config = result.rows[0].config;
      // DB 中的 config 是完整 JSONB，已包含所有字段
      return config;
    }
  } catch (err) {
    // DB 查询失败时静默降级到 YAML（启动阶段 DB 可能未就绪）
    console.warn(`[content-type-registry] DB 查询失败，降级到 YAML：${err.message}`);
  }

  // 2. DB 无记录 → 读 YAML 文件（兜底）
  return getContentTypeFromYaml(typeName);
}

/**
 * 列出所有已注册的内容类型名称（合并 DB + YAML，去重）
 * @returns {string[]} 内容类型名称数组
 */
async function listContentTypes() {
  const yamlTypes = listContentTypesFromYaml();

  // 从 DB 查询所有已注册类型
  let dbTypes = [];
  try {
    const result = await pool.query(
      'SELECT content_type FROM content_type_configs ORDER BY content_type'
    );
    dbTypes = result.rows.map((r) => r.content_type);
  } catch (err) {
    // DB 查询失败时仅返回 YAML 类型
    console.warn(`[content-type-registry] DB 查询失败，仅返回 YAML 类型：${err.message}`);
  }

  // 合并去重：DB 类型优先（排在前面），YAML 补充
  const merged = [...new Set([...dbTypes, ...yamlTypes])];
  return merged;
}

/**
 * 加载所有内容类型配置（启动时验证用）
 * @returns {{ name: string, config: object }[]} 所有类型配置数组
 * @throws {Error} 任何类型配置无效时抛出
 */
async function loadAllContentTypes() {
  const names = await listContentTypes();
  const results = [];
  for (const name of names) {
    const config = await getContentType(name);
    results.push({ name, config });
  }
  return results;
}

export {
  getContentType,
  getContentTypeFromYaml,
  listContentTypes,
  listContentTypesFromYaml,
  loadAllContentTypes,
};
