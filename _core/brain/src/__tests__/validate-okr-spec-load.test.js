/**
 * OKR Validation Spec 加载测试
 * DoD: D1
 */

import { describe, it, expect, afterEach } from 'vitest';
import { loadSpec, _resetSpecCache } from '../validate-okr-structure.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '../../../config/okr-validation-spec.yml');

afterEach(() => {
  _resetSpecCache();
});

describe('D1: okr-validation-spec.yml 加载', () => {
  it('能被 js-yaml 成功解析', () => {
    const spec = loadSpec(SPEC_PATH);
    expect(spec).toBeDefined();
    expect(typeof spec).toBe('object');
  });

  it('包含 version 字段', () => {
    const spec = loadSpec(SPEC_PATH);
    expect(spec.version).toBe(1);
  });

  it('包含 severity_levels', () => {
    const spec = loadSpec(SPEC_PATH);
    expect(spec.severity_levels).toBeDefined();
    expect(spec.severity_levels.BLOCK).toBeDefined();
    expect(spec.severity_levels.WARNING).toBeDefined();
  });

  it('包含 goals 定义（4 种类型）', () => {
    const spec = loadSpec(SPEC_PATH);
    expect(spec.goals).toBeDefined();
    expect(spec.goals.global_okr).toBeDefined();
    expect(spec.goals.global_kr).toBeDefined();
    expect(spec.goals.area_okr).toBeDefined();
    expect(spec.goals.area_kr).toBeDefined();
  });

  it('包含 projects 定义（2 种类型）', () => {
    const spec = loadSpec(SPEC_PATH);
    expect(spec.projects).toBeDefined();
    expect(spec.projects.project).toBeDefined();
    expect(spec.projects.initiative).toBeDefined();
  });

  it('包含 pr_plans 定义', () => {
    const spec = loadSpec(SPEC_PATH);
    expect(spec.pr_plans).toBeDefined();
    expect(spec.pr_plans.required_fields).toContain('title');
    expect(spec.pr_plans.dependency_graph).toBeDefined();
  });

  it('包含 tasks 定义', () => {
    const spec = loadSpec(SPEC_PATH);
    expect(spec.tasks).toBeDefined();
    expect(spec.tasks.required_fields).toContain('title');
    expect(spec.tasks.text_rules.title.forbidden_phrases).toBeDefined();
  });

  it('包含 global_rules', () => {
    const spec = loadSpec(SPEC_PATH);
    expect(spec.global_rules).toBeDefined();
    expect(spec.global_rules.orphans).toBeInstanceOf(Array);
    expect(spec.global_rules.active_status_filter).toBeDefined();
  });

  it('缓存正常工作（默认路径）', () => {
    // 第一次不传 specPath → 缓存
    const spec1 = loadSpec();
    // 第二次不传 → 命中缓存，同一引用
    const spec2 = loadSpec();
    expect(spec2).toBe(spec1);
  });

  it('自定义路径不写入缓存', () => {
    const spec1 = loadSpec(SPEC_PATH);
    const spec2 = loadSpec(SPEC_PATH);
    // 每次都重新解析，不是同一引用
    expect(spec2).not.toBe(spec1);
    expect(spec2).toEqual(spec1);
  });

  it('无效路径抛出错误', () => {
    expect(() => loadSpec('/nonexistent/path.yml')).toThrow();
  });
});
