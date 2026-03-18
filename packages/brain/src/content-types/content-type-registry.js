/**
 * Content Type Registry
 * 内容类型注册表加载器 — YAML 驱动，解耦内容类型与 Pipeline 代码
 *
 * 新增内容类型：在 content-types/ 目录下添加 <type-name>.yaml 文件，无需改代码。
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

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
 * 加载并解析指定内容类型的 YAML 配置
 * @param {string} typeName - 内容类型名称（如 "solo-company-case"）
 * @returns {object|null} 内容类型配置对象，类型不存在时返回 null
 * @throws {Error} 配置无效时抛出
 */
async function getContentType(typeName) {
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
 * 列出所有已注册的内容类型名称
 * @returns {string[]} 内容类型名称数组
 */
async function listContentTypes() {
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

export { getContentType, listContentTypes, loadAllContentTypes };
