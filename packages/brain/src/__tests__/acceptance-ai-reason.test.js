import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, afterEach } from 'vitest';
import { validateAiReason, getSpecSets, _resetSpecSetsForTest } from '../routes/acceptance.js';
import { loadSpec, buildCells, deriveSets } from '../acceptance-spec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures/acceptance/line02-android.yaml');
const cells = buildCells(loadSpec(FIXTURE).doc);
const sets = deriveSets(cells);

describe('A4③ reason=human_only 绑格的静态属性，不是 AI 说了算', () => {
  it('machine_db 格自报 human_only → 400', () => {
    const err = validateAiReason({ check_key: 'S7-c1', reason: 'human_only' }, sets);
    expect(err).toMatchObject({ status: 400 });
    expect(err.body.error).toBe('reason_not_allowed_for_cell');
  });

  it('human_only 格自报 human_only → 放行', () => {
    expect(validateAiReason({ check_key: 'S12-c1', reason: 'human_only' }, sets)).toBeNull();
  });
});

describe('A4⑥⑦ scenario_not_triggered 合法域为空集（拍板②后 opportunistic = ∅）', () => {
  it('对 36 个建行格逐格提交 → 36 次全部 400，无一例外', () => {
    const rejected = cells
      .map((c) => validateAiReason({ check_key: c.check_key, reason: 'scenario_not_triggered' }, sets))
      .filter((e) => e && e.status === 400);
    expect(rejected).toHaveLength(36);
    // 无条件 reject：不查上下文、不看单头是否勾了场景码——合法域为空与上下文无关
    expect(new Set(rejected.map((e) => e.body.error))).toEqual(new Set(['reason_domain_empty']));
  });
});

describe('故障类 reason 允许落库（由 Q3′ 承载，不进绿通道）', () => {
  for (const reason of ['page_unreachable', 'login_failed', 'timeout']) {
    it(`${reason} 放行`, () => {
      expect(validateAiReason({ check_key: 'S7-c1', reason }, sets)).toBeNull();
    });
  }
});

describe('未知格号与未知 reason', () => {
  it('不在建行集合里的格号 → 400', () => {
    expect(validateAiReason({ check_key: 'S14-c1', reason: 'timeout' }, sets)).toMatchObject({ status: 400 });
  });

  it('无 reason（AI 给了确定判定）→ 放行', () => {
    expect(validateAiReason({ check_key: 'S7-c1', reason: null }, sets)).toBeNull();
  });

  it('枚举外的 reason → 400 unknown_reason', () => {
    const err = validateAiReason({ check_key: 'S7-c1', reason: 'i_was_lazy' }, sets);
    expect(err).toMatchObject({ status: 400 });
    expect(err.body.error).toBe('unknown_reason');
  });
});

describe('增项1 服务端读规程只认 ACCEPTANCE_SPEC_PATH', () => {
  const ORIGINAL = process.env.ACCEPTANCE_SPEC_PATH;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ACCEPTANCE_SPEC_PATH;
    else process.env.ACCEPTANCE_SPEC_PATH = ORIGINAL;
    _resetSpecSetsForTest();
  });

  it('env 已配 → 读的就是 env 指的那份', () => {
    process.env.ACCEPTANCE_SPEC_PATH = FIXTURE;
    _resetSpecSetsForTest();
    const loaded = getSpecSets();
    expect(loaded.version).toBe('2.1.19');
    expect(loaded.machineDbList).toHaveLength(19);
    expect(loaded.byKey.get('S7-c1').verifiable_by).toBe('machine_db');
  });

  it('env 缺失 → 抛可操作错误，不静默回落到 DEFAULT_SPEC_PATH 那个本机绝对路径', () => {
    // 回落是最坏的降级：CI/容器上那条路径不存在只会变成裸 ENOENT，而本机上它恰好存在
    // 且可能是另一版规程——服务端于是拿着一份和已发布规程不同的静态属性去判 reason。
    delete process.env.ACCEPTANCE_SPEC_PATH;
    _resetSpecSetsForTest();
    expect(() => getSpecSets()).toThrow(/ACCEPTANCE_SPEC_PATH/);
  });

  it('env 指向不存在的文件 → 抛错带上那条路径，不是裸 ENOENT', () => {
    process.env.ACCEPTANCE_SPEC_PATH = '/nonexistent/acceptance-spec/line02-android.yaml';
    _resetSpecSetsForTest();
    expect(() => getSpecSets()).toThrow(/\/nonexistent\/acceptance-spec\/line02-android\.yaml/);
  });
});
