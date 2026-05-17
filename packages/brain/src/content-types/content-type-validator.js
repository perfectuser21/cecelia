/**
 * Content Type Validator
 * 内容类型 YAML 配置轻量格式校验器
 *
 * 校验 content-types/ 目录下所有 YAML 文件，
 * 在 Brain 启动时由 selfcheck 调用，有问题时打印 WARN（不阻断启动）。
 */

import { listContentTypes, getContentType } from './content-type-registry.js';

/** 必填字段及其层级路径 */
const REQUIRED_CHECKS = [
  {
    path: 'content_type',
    check: (c) => typeof c.content_type === 'string' && c.content_type.length > 0,
    message: '缺少必填字段 content_type（字符串）',
  },
  {
    path: 'images.count',
    check: (c) => c.images && typeof c.images.count === 'number' && c.images.count > 0,
    message: '缺少必填字段 images.count（正整数）',
  },
  {
    path: 'template.generate_prompt',
    check: (c) =>
      c.template &&
      typeof c.template.generate_prompt === 'string' &&
      c.template.generate_prompt.length > 0,
    message: '缺少必填字段 template.generate_prompt（字符串）',
  },
];

/**
 * 校验单个内容类型配置对象
 * @param {object} config - 已解析的 YAML 配置
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateContentType(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['配置对象为空或类型错误'] };
  }

  const errors = [];
  for (const rule of REQUIRED_CHECKS) {
    if (!rule.check(config)) {
      errors.push(rule.message);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 读取 content-types/ 目录下所有 YAML 文件，批量校验
 * @returns {Promise<{ valid: boolean, results: Array<{name: string, valid: boolean, errors: string[]}> }>}
 */
export async function validateAllContentTypes() {
  let names;
  try {
    names = await listContentTypes();
  } catch (err) {
    return {
      valid: false,
      results: [{ name: '__directory__', valid: false, errors: [`读取目录失败：${err.message}`] }],
    };
  }

  const results = [];
  let allValid = true;

  for (const name of names) {
    let config;
    try {
      config = await getContentType(name);
    } catch (err) {
      results.push({ name, valid: false, errors: [`加载失败：${err.message}`] });
      allValid = false;
      continue;
    }

    const { valid, errors } = validateContentType(config);
    results.push({ name, valid, errors });
    if (!valid) allValid = false;
  }

  return { valid: allValid, results };
}
