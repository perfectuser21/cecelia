/**
 * content-type-registry notebook_id 补充逻辑单元测试
 * 验证：当 DB config 没有 notebook_id 时，从 YAML 补充
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB pool — 返回无 notebook_id 的旧 config
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Mock fs — 控制 YAML 内容
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => ['solo-company-case.yaml']),
  readFileSync: vi.fn(() => `
content_type: solo-company-case
title: 一人公司成功案例
notebook_id: "1d928181-4462-47d4-b4c0-89d3696344ab"
images:
  count: 9
  format: svg
template:
  research_prompt: "调研 {keyword}"
  generate_prompt: "生成 {keyword}"
review_rules:
  - id: data_accuracy
    severity: blocking
    description: 数据必须有来源
copy_rules:
  platform_tone:
    xiaohongshu: 口语化
`),
}));

import { getContentType } from '../content-types/content-type-registry.js';

describe('content-type-registry — notebook_id 补充逻辑', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DB config 有 notebook_id 时，直接返回 DB 值', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        config: {
          content_type: 'solo-company-case',
          notebook_id: 'db-notebook-id-override',
          images: { count: 9 },
        },
      }],
    });

    const config = await getContentType('solo-company-case');
    expect(config.notebook_id).toBe('db-notebook-id-override');
  });

  it('DB config 没有 notebook_id 时，从 YAML 补充', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        config: {
          content_type: 'solo-company-case',
          // 无 notebook_id（旧 DB seed 数据）
          images: { count: 9 },
          template: { research_prompt: '调研', generate_prompt: '生成' },
          review_rules: [],
        },
      }],
    });

    const config = await getContentType('solo-company-case');
    expect(config.notebook_id).toBe('1d928181-4462-47d4-b4c0-89d3696344ab');
  });

  it('DB config notebook_id 为空字符串时，从 YAML 补充', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        config: {
          content_type: 'solo-company-case',
          notebook_id: '',
          images: { count: 9 },
        },
      }],
    });

    const config = await getContentType('solo-company-case');
    // 空字符串是 falsy，应从 YAML 补充
    expect(config.notebook_id).toBe('1d928181-4462-47d4-b4c0-89d3696344ab');
  });

  it('DB 无记录时，直接返回 YAML config（含 notebook_id）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const config = await getContentType('solo-company-case');
    expect(config).not.toBeNull();
    expect(config.notebook_id).toBe('1d928181-4462-47d4-b4c0-89d3696344ab');
  });

  it('DB 查询失败时，降级到 YAML（含 notebook_id）', async () => {
    mockQuery.mockRejectedValue(new Error('DB 连接失败'));

    const config = await getContentType('solo-company-case');
    expect(config).not.toBeNull();
    expect(config.notebook_id).toBe('1d928181-4462-47d4-b4c0-89d3696344ab');
  });
});
