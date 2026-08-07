import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { loadSpec, buildCells, deriveSets, computeSpecSha } from '../acceptance-spec.js';
import { buildChecksFromSpec } from '../../scripts/acceptance/build-checks-from-spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures/acceptance/line02-android.yaml');

describe('生成器对真规程产出恰 36 行', () => {
  const { checks, spec_sha, version, stats } = buildChecksFromSpec(FIXTURE);

  it('恰 36 行', () => expect(checks).toHaveLength(36));

  it('格号全部匹配 ^S\\d+-c[1-4]$', () => {
    expect(checks.filter((c) => !/^S\d+-c[1-4]$/.test(c.check_key))).toEqual([]);
  });

  it('零个 S14-*（fixedNa 步骤全部四格排除，含有 t 的 c1）', () => {
    expect(checks.filter((c) => c.check_key.startsWith('S14-'))).toEqual([]);
  });

  it('每行 kind/verifiable_by 齐全，detail 带静态属性', () => {
    for (const c of checks) {
      expect(['FR', 'NFR', 'Invariant', 'SOP']).toContain(c.kind);
      expect(['human_only', 'machine_db', 'machine_visual']).toContain(c.detail.verifiable_by);
      expect(typeof c.detail.hard).toBe('boolean');
      expect(typeof c.detail.step_n).toBe('number');
      expect(typeof c.detail.step_name).toBe('string');
      expect(Array.isArray(c.detail.fails)).toBe(true);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.device).toBeNull();
    }
  });

  it('S1-c4 有 t 但 na:true → 不建行', () => {
    expect(checks.find((c) => c.check_key === 'S1-c4')).toBeUndefined();
  });

  it('version 直取 yaml.version', () => expect(version).toBe('2.1.19'));

  it('spec_sha 是 yaml 文件原始字节的 sha256（不是重序列化）', () => {
    const raw = fs.readFileSync(FIXTURE);
    expect(spec_sha).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(computeSpecSha(raw)).toBe(spec_sha);
    // 重序列化会随 js-yaml 版本漂移，让冻结锁在无人改规程时误报 stale
    expect(spec_sha).not.toBe(
      createHash('sha256').update(yaml.dump(yaml.load(raw.toString()))).digest('hex')
    );
  });

  it('stats 汇总与口径定案表相等', () => {
    expect(stats).toMatchObject({
      total: 36, human_only: 17, machine_db: 19, hard: 8, mandatory: 5, unverifiable: 1,
    });
  });
});

describe('A14 生成器排除集回归（构造 yaml：S7 也标 fixedNa）', () => {
  it('建行数从 36 降到 34，且结果不含任何 S7-*', () => {
    const doc = yaml.load(fs.readFileSync(FIXTURE, 'utf-8'));
    doc.steps.find((s) => s.n === 7).fixedNa = true;   // S7 有效格 = c1/c2 共 2 格
    const cells = buildCells(doc);
    expect(cells).toHaveLength(34);
    expect(cells.filter((c) => c.check_key.startsWith('S7-'))).toEqual([]);
  });
});

describe('增项2 格号重复必须 fail-fast（防建单在 (run_id,check_key) 上静默塌行）', () => {
  it('规程里 step.n 重复 → buildCells 抛错，错误里带上重复格号', () => {
    const doc = yaml.load(fs.readFileSync(FIXTURE, 'utf-8'));
    doc.steps.push({ ...doc.steps.find((s) => s.n === 7) });   // 同一个 n 出现两次
    expect(() => buildCells(doc)).toThrow(/S7-c1/);
  });

  it('规程结构异常（steps 不是数组）→ 抛可读错误，不是 "doc.steps is not iterable"', () => {
    expect(() => buildCells({ version: '9.9.9', steps: '不是数组' })).toThrow(/steps/);
  });

  it('无重复时照常产出 36 行', () => {
    expect(buildCells(loadSpec(FIXTURE).doc)).toHaveLength(36);
  });
});

describe('deriveSets — 四个占位符共用同一套解析（禁硬编码 19/17/5）', () => {
  const sets = deriveSets(buildCells(loadSpec(FIXTURE).doc));

  it(':human_only_list 恰 17 格', () => expect(sets.humanOnlyList).toHaveLength(17));
  it(':machine_db_list 恰 19 格', () => expect(sets.machineDbList).toHaveLength(19));
  it(':unverifiable_list = {S13-c4}', () => expect(sets.unverifiableList).toEqual(['S13-c4']));
  it(':mandatory_scenario_codes 恰 5 且逐格相等', () => {
    expect([...sets.mandatoryScenarioCodes].sort())
      .toEqual(['S10-c4', 'S4-c2', 'S4-c3', 'S5-c3', 'S5-c4'].sort());
  });
  it('A17⑥ mandatory ∩ machine_db 基数 5', () => {
    expect(sets.mandatoryMachineDbList).toHaveLength(5);
  });
  it('hard 恰 8 格', () => expect(sets.hardList).toHaveLength(8));
});

describe('spec_sha 对真实 zenithjoy 规程（本机有 repo 时才跑）', () => {
  // 守卫专用 env，**不是** ACCEPTANCE_SPEC_PATH：后者被 vitest.config 全局钉在 fixture 上，
  // 复用它会让 REAL 恒等于 FIXTURE，本条退化成"fixture 跟自己比"的恒真断言，守卫永久空转。
  // vitest.config 刻意不设 ACCEPTANCE_REAL_SPEC_PATH，于是本机默认落到 zenithjoy 真路径，
  // 恢复"zenithjoy 侧补完静态属性合并后，漂移守卫自动上岗"的原语义。
  const REAL = process.env.ACCEPTANCE_REAL_SPEC_PATH
    || '/Users/administrator/perfect21/zenithjoy-workspace/acceptance-spec/line02-android.yaml';
  // 只有当本机那份真规程已经带上 D1 静态属性时，跟 fixture 比才有意义：zenithjoy 侧
  // 补 kind/scenario_class 的 PR 合并之前，主干那份还是 D1 之前的版本，stats 天然不等，
  // 那是版本差不是 fixture 漂移。合并后此条件自动成立，漂移守卫随即上岗。
  // 兜一层：万一有人把 ACCEPTANCE_REAL_SPEC_PATH 也指到 fixture，同样是恒真断言，直接 skip。
  const comparable = path.resolve(REAL) !== path.resolve(FIXTURE)
    && fs.existsSync(REAL) && buildCells(loadSpec(REAL).doc).every((c) => c.kind);

  it.skipIf(!comparable)('真规程与 fixture 的建行结果逐格相等（fixture 未漂移）', () => {
    const real = buildChecksFromSpec(REAL);
    const fx = buildChecksFromSpec(FIXTURE);
    expect(real.checks.map((c) => c.check_key)).toEqual(fx.checks.map((c) => c.check_key));
    expect(real.stats).toEqual(fx.stats);
  });
});
