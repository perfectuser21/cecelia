/**
 * 刀1: Manifest Schema 校验测试（无需 DB）
 * 覆盖：JSON Schema 校验、语义校验、digest 确定性
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MANIFEST_SCHEMA_V1, validateManifestSemantics } from '../manifest-schema.js';
import { computeManifestDigest } from '../manifest-store.js';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(MANIFEST_SCHEMA_V1);

// Cecelia 首验 manifest（来自 PRD 第九节）
const CECELIA_MANIFEST = {
  scope_key: 'cecelia',
  schema_version: 1,
  source_decision_id: '4bc109e9-3b70-4b17-a1b4-bcd01bfae776',
  value_streams: [
    { key: 'factory', name: '工厂', perceiver: '待造软件', order: 1 },
    { key: 'butler', name: '管家', perceiver: '主理人本人', order: 2 },
  ],
  capabilities: [
    { key: 'F0', name: '提案打磨', value_stream_key: 'factory', order: 1 },
    { key: 'F1', name: '开发闭环', value_stream_key: 'factory', order: 2 },
    { key: 'F2', name: '部署闭环', value_stream_key: 'factory', order: 3 },
    { key: 'F3', name: '夜间体检', value_stream_key: 'factory', order: 4 },
    { key: 'F4', name: '故障自愈', value_stream_key: 'factory', order: 5 },
    { key: 'MJ5', name: '承诺地图', value_stream_key: 'factory', order: 6 },
    { key: 'G1', name: '指挥舱', value_stream_key: 'butler', order: 1, aliases: ['F5'] },
    { key: 'G2', name: '收件箱', value_stream_key: 'butler', order: 2, aliases: ['F6'] },
    { key: 'G3', name: '晨报感知', value_stream_key: 'butler', order: 3 },
    { key: 'G4', name: '记忆知识', value_stream_key: 'butler', order: 4, aliases: ['F7'] },
    { key: 'G5', name: '战略 OKR', value_stream_key: 'butler', order: 5 },
  ],
  boundaries: [
    { key: 'F0_TO_G1', from: 'F0', to: 'G1', statement: '提案备好呈报是 F0 终点；拍板动作归 G1' },
    { key: 'F3_TO_G3', from: 'F3', to: 'G3', statement: '体检报告落账本是 F3 终点；主理人一屏消费是 G3 终点' },
  ],
  crosscut_pool: [
    { key: 'heartbeat_bus', name: '心跳传送带', serves: ['factory', 'butler'] },
    { key: 'credential_chain', name: '凭据链', serves: ['factory', 'butler'] },
    { key: 'execution_pool', name: '执行资源池', aliases: ['infrastructure', 'F8'], serves: ['factory', 'butler'] },
    { key: 'skill_distribution', name: 'Skill 分发链', owner: 'F1', serves: ['factory', 'butler'] },
    { key: 'alert_chain', name: '告警链', owner: 'F4', serves: ['factory', 'butler'] },
    { key: 'database_foundation', name: '数据库', owner: 'F1', serves: ['factory', 'butler'] },
    { key: 'network_foundation', name: '网络', owner: 'F1', serves: ['factory', 'butler'] },
  ],
  shared_prerequisites: {
    applicable: false,
    items: [],
    reason: '工厂与管家的感知者分别为待造软件和主理人本人，不存在客户产品线式一次性入场语义',
  },
};

describe('Manifest JSON Schema 校验', () => {
  it('Cecelia 首验 manifest 通过 schema 校验', () => {
    const valid = validateSchema(CECELIA_MANIFEST);
    if (!valid) console.error('Schema errors:', validateSchema.errors);
    expect(valid).toBe(true);
  });

  it('生产 Cecelia manifest 的路径归属同时通过 schema 与语义校验', () => {
    const productionManifest = JSON.parse(readFileSync(
      new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url),
      'utf8',
    ));

    expect(validateSchema(productionManifest)).toBe(true);
    expect(validateManifestSemantics(productionManifest)).toEqual({ valid: true, errors: [] });
  });

  it('缺少必填字段 scope_key 时报错', () => {
    const bad = { ...CECELIA_MANIFEST };
    delete bad.scope_key;
    expect(validateSchema(bad)).toBe(false);
  });

  it('schema_version 不是 1 时报错', () => {
    const bad = { ...CECELIA_MANIFEST, schema_version: 2 };
    expect(validateSchema(bad)).toBe(false);
  });

  it('scope_key 含非法字符时报错', () => {
    const bad = { ...CECELIA_MANIFEST, scope_key: 'CeCeLiA' };
    expect(validateSchema(bad)).toBe(false);
  });
});

describe('Manifest 语义校验', () => {
  it('Cecelia 首验 manifest 语义通过', () => {
    const result = validateManifestSemantics(CECELIA_MANIFEST);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('Capability 引用不存在的 value_stream_key 时报错', () => {
    const bad = {
      ...CECELIA_MANIFEST,
      capabilities: [
        ...CECELIA_MANIFEST.capabilities,
        { key: 'BAD', name: '测试', value_stream_key: 'nonexistent', order: 99 },
      ],
    };
    const result = validateManifestSemantics(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nonexistent'))).toBe(true);
  });

  it('Boundary from/to 引用不存在 capability 时报错', () => {
    const bad = {
      ...CECELIA_MANIFEST,
      boundaries: [
        ...CECELIA_MANIFEST.boundaries,
        { key: 'BAD_B', from: 'X1', to: 'Y2', statement: 'test' },
      ],
    };
    const result = validateManifestSemantics(bad);
    expect(result.valid).toBe(false);
  });

  it('capability key 重复时报错', () => {
    const bad = {
      ...CECELIA_MANIFEST,
      capabilities: [
        ...CECELIA_MANIFEST.capabilities,
        { key: 'F1', name: '重复', value_stream_key: 'factory', order: 99 },
      ],
    };
    const result = validateManifestSemantics(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('F1'))).toBe(true);
  });

  it('applicable=false 时 items 必须为空', () => {
    const bad = {
      ...CECELIA_MANIFEST,
      shared_prerequisites: { applicable: false, items: [{ key: 'x' }], reason: 'test' },
    };
    const result = validateManifestSemantics(bad);
    expect(result.valid).toBe(false);
  });

  it('拒绝逃逸或 option-shaped 的 Capability 路径所有权', () => {
    const bad = {
      ...CECELIA_MANIFEST,
      capabilities: CECELIA_MANIFEST.capabilities.map((capability, index) => (
        index === 0
          ? { ...capability, path_prefixes: ['../outside/'], exact_paths: ['-config'] }
          : capability
      )),
    };
    expect(validateManifestSemantics(bad).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('path_prefixes'),
      expect.stringContaining('exact_paths'),
    ]));
  });

  it('精确验证 2 条 Value Stream、11 个 Capability', () => {
    expect(CECELIA_MANIFEST.value_streams).toHaveLength(2);
    expect(CECELIA_MANIFEST.capabilities).toHaveLength(11);
  });

  it('精确验证 2 条 Boundary', () => {
    expect(CECELIA_MANIFEST.boundaries).toHaveLength(2);
  });

  it('精确验证 7 项 Cross-cut', () => {
    expect(CECELIA_MANIFEST.crosscut_pool).toHaveLength(7);
  });

  it('F5/F6/F7 只作为别名，不是独立 capability', () => {
    const capKeys = new Set(CECELIA_MANIFEST.capabilities.map((c) => c.key));
    expect(capKeys.has('F5')).toBe(false);
    expect(capKeys.has('F6')).toBe(false);
    expect(capKeys.has('F7')).toBe(false);
    const g1 = CECELIA_MANIFEST.capabilities.find((c) => c.key === 'G1');
    expect(g1?.aliases).toContain('F5');
  });

  it('F8 不是 Capability，只作为 execution_pool 别名', () => {
    const capKeys = new Set(CECELIA_MANIFEST.capabilities.map((c) => c.key));
    expect(capKeys.has('F8')).toBe(false);
    const execPool = CECELIA_MANIFEST.crosscut_pool.find((c) => c.key === 'execution_pool');
    expect(execPool?.aliases).toContain('F8');
  });
});

describe('Manifest digest 确定性', () => {
  it('相同 manifest 产生相同 digest', () => {
    const d1 = computeManifestDigest(CECELIA_MANIFEST);
    const d2 = computeManifestDigest(CECELIA_MANIFEST);
    expect(d1).toBe(d2);
  });

  it('digest 是 64 位十六进制字符串（SHA-256）', () => {
    const d = computeManifestDigest(CECELIA_MANIFEST);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  it('不同 manifest 产生不同 digest', () => {
    const d1 = computeManifestDigest(CECELIA_MANIFEST);
    const d2 = computeManifestDigest({ ...CECELIA_MANIFEST, scope_key: 'zenithjoy' });
    expect(d1).not.toBe(d2);
  });
});
