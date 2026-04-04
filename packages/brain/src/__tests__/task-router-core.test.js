/**
 * task-router-core.test.js
 *
 * 覆盖 task-router.js 核心路由逻辑中尚未被其他测试文件覆盖的部分：
 *   - identifyWorkType（单任务 / 功能 / ask_autumnrice 分类）
 *   - getTaskLocation（全量 task_type → location 映射，含边界情况）
 *   - determineExecutionMode（执行模式决策树）
 *   - routeTaskCreate（完整路由结果结构，含上下文字段）
 *   - getLocationsForTaskTypes（批量路由）
 *   - isValidLocation（location 校验）
 *   - LOCATION_MAP / SKILL_WHITELIST / VALID_TASK_TYPES / DEFAULT_LOCATION
 *     完整性与一致性断言
 *   - HK 路由类型专项（talk / research / data / explore）
 *   - architecture_design 路由
 *   - 大小写不敏感行为
 *   - 输入边界（null / undefined / 空字符串 / 非字符串）
 *
 * 不重复覆盖（已在其他文件中测试）：
 *   - detectRoutingFailure / getFallbackStrategy / routeTaskWithFallback
 *   - diagnoseKR
 *   - code_review / decomp_review / codex_qa / suggestion_plan / initiative_plan/verify
 *     的单独类型断言
 *   - FALLBACK_STRATEGIES 结构
 */

import { describe, it, expect } from 'vitest';
import {
  identifyWorkType,
  getTaskLocation,
  determineExecutionMode,
  routeTaskCreate,
  getLocationsForTaskTypes,
  isValidLocation,
  isValidTaskType,
  getValidTaskTypes,
  LOCATION_MAP,
  SKILL_WHITELIST,
  VALID_TASK_TYPES,
  DEFAULT_LOCATION,
  SINGLE_TASK_PATTERNS,
  FEATURE_PATTERNS
} from '../task-router.js';

// ============================================================
// identifyWorkType
// ============================================================

describe('identifyWorkType - single task patterns', () => {
  it('中文"修复"识别为 single', () => {
    expect(identifyWorkType('修复登录 bug')).toBe('single');
  });

  it('英文 fix 识别为 single', () => {
    expect(identifyWorkType('fix the broken endpoint')).toBe('single');
  });

  it('"bugfix" 识别为 single', () => {
    expect(identifyWorkType('bugfix: null pointer in tick')).toBe('single');
  });

  it('"hotfix" 识别为 single', () => {
    expect(identifyWorkType('hotfix production crash')).toBe('single');
  });

  it('"patch" 识别为 single', () => {
    expect(identifyWorkType('patch response header')).toBe('single');
  });

  it('"typo" 识别为 single', () => {
    expect(identifyWorkType('typo in README')).toBe('single');
  });

  it('"refactor small" 识别为 single', () => {
    expect(identifyWorkType('refactor small util function')).toBe('single');
  });

  it('"改一下" 识别为 single', () => {
    expect(identifyWorkType('改一下配置文件')).toBe('single');
  });

  it('"加个" 识别为 single', () => {
    expect(identifyWorkType('加个日志输出')).toBe('single');
  });

  it('"删掉" 识别为 single', () => {
    expect(identifyWorkType('删掉旧的接口')).toBe('single');
  });

  it('"更新" 识别为 single', () => {
    expect(identifyWorkType('更新依赖版本')).toBe('single');
  });

  it('"调整" 识别为 single', () => {
    expect(identifyWorkType('调整超时参数')).toBe('single');
  });

  it('"修改" 识别为 single', () => {
    expect(identifyWorkType('修改数据库连接池大小')).toBe('single');
  });

  it('大小写不敏感：FIX 识别为 single', () => {
    expect(identifyWorkType('FIX broken tests')).toBe('single');
  });
});

describe('identifyWorkType - feature patterns', () => {
  it('"实现" 识别为 feature', () => {
    expect(identifyWorkType('实现用户认证模块')).toBe('feature');
  });

  it('"做一个" 识别为 feature', () => {
    expect(identifyWorkType('做一个任务派发器')).toBe('feature');
  });

  it('"新功能" 识别为 feature', () => {
    expect(identifyWorkType('新功能：支持飞书通知')).toBe('feature');
  });

  it('"系统" 识别为 feature', () => {
    expect(identifyWorkType('搭建监控系统')).toBe('feature');
  });

  it('"模块" 识别为 feature', () => {
    expect(identifyWorkType('拆分路由模块')).toBe('feature');
  });

  it('"重构" 识别为 feature', () => {
    expect(identifyWorkType('重构 Brain 调度层')).toBe('feature');
  });

  it('"implement" 识别为 feature', () => {
    expect(identifyWorkType('implement task retry logic')).toBe('feature');
  });

  it('"feature" 识别为 feature', () => {
    expect(identifyWorkType('feature: add dark mode')).toBe('feature');
  });

  it('"build" 识别为 feature', () => {
    expect(identifyWorkType('build the notification pipeline')).toBe('feature');
  });

  it('"create a" 识别为 feature', () => {
    expect(identifyWorkType('create a new scheduler service')).toBe('feature');
  });

  it('"develop" 识别为 feature', () => {
    expect(identifyWorkType('develop agent bridge layer')).toBe('feature');
  });

  it('"设计" 识别为 feature', () => {
    expect(identifyWorkType('设计数据库 schema')).toBe('feature');
  });

  it('"架构" 识别为 feature', () => {
    expect(identifyWorkType('架构改造方案')).toBe('feature');
  });
});

describe('identifyWorkType - uncertain / ask_autumnrice', () => {
  it('无法识别的描述返回 ask_autumnrice', () => {
    expect(identifyWorkType('看一下这个问题')).toBe('ask_autumnrice');
  });

  it('空字符串返回 ask_autumnrice', () => {
    expect(identifyWorkType('')).toBe('ask_autumnrice');
  });

  it('null 返回 ask_autumnrice', () => {
    expect(identifyWorkType(null)).toBe('ask_autumnrice');
  });

  it('undefined 返回 ask_autumnrice', () => {
    expect(identifyWorkType(undefined)).toBe('ask_autumnrice');
  });

  it('非字符串数字返回 ask_autumnrice', () => {
    expect(identifyWorkType(42)).toBe('ask_autumnrice');
  });

  it('pure whitespace 返回 ask_autumnrice', () => {
    expect(identifyWorkType('   ')).toBe('ask_autumnrice');
  });
});

describe('identifyWorkType - single 优先于 feature（匹配顺序）', () => {
  it('同时含 single + feature 关键词时，single 优先', () => {
    // "修复" 是 single pattern，即使句子里还有 "实现"
    expect(identifyWorkType('修复实现中的 bug')).toBe('single');
  });
});

// ============================================================
// getTaskLocation - HK 类型专项
// ============================================================

describe('getTaskLocation - XIAN 通用路由类型', () => {
  it('talk → xian', () => {
    expect(getTaskLocation('talk')).toBe('xian');
  });

  it('research → xian', () => {
    expect(getTaskLocation('research')).toBe('xian');
  });

  it('data → xian', () => {
    expect(getTaskLocation('data')).toBe('xian');
  });

  it('explore → xian', () => {
    expect(getTaskLocation('explore')).toBe('xian');
  });
});

describe('getTaskLocation - US 路由类型', () => {
  it('dev → us', () => {
    expect(getTaskLocation('dev')).toBe('us');
  });

  it('review → us', () => {
    expect(getTaskLocation('review')).toBe('us');
  });

  it('qa → us', () => {
    expect(getTaskLocation('qa')).toBe('us');
  });

  it('audit → us', () => {
    expect(getTaskLocation('audit')).toBe('us');
  });

  it('knowledge → xian', () => {
    expect(getTaskLocation('knowledge')).toBe('xian');
  });

  it('dept_heartbeat → us', () => {
    expect(getTaskLocation('dept_heartbeat')).toBe('us');
  });

  it('architecture_design → us', () => {
    expect(getTaskLocation('architecture_design')).toBe('us');
  });
});

describe('getTaskLocation - 边界情况', () => {
  it('未知 task_type 返回 DEFAULT_LOCATION (us)', () => {
    expect(getTaskLocation('unknown_xyz')).toBe(DEFAULT_LOCATION);
    expect(getTaskLocation('unknown_xyz')).toBe('us');
  });

  it('null 返回 DEFAULT_LOCATION', () => {
    expect(getTaskLocation(null)).toBe(DEFAULT_LOCATION);
  });

  it('undefined 返回 DEFAULT_LOCATION', () => {
    expect(getTaskLocation(undefined)).toBe(DEFAULT_LOCATION);
  });

  it('空字符串返回 DEFAULT_LOCATION', () => {
    expect(getTaskLocation('')).toBe(DEFAULT_LOCATION);
  });

  it('大小写不敏感：DEV → us', () => {
    expect(getTaskLocation('DEV')).toBe('us');
  });

  it('大小写不敏感：TALK → xian', () => {
    expect(getTaskLocation('TALK')).toBe('xian');
  });

  it('大小写不敏感：Research → xian', () => {
    expect(getTaskLocation('Research')).toBe('xian');
  });
});

// ============================================================
// determineExecutionMode
// ============================================================

describe('determineExecutionMode', () => {
  it('is_recurring=true 返回 recurring，优先级最高', () => {
    expect(determineExecutionMode({ input: '修复 bug', feature_id: 'f-1', is_recurring: true })).toBe('recurring');
  });

  it('feature_id 存在且非 recurring 返回 feature_task', () => {
    expect(determineExecutionMode({ input: '修复 bug', feature_id: 'f-1', is_recurring: false })).toBe('feature_task');
  });

  it('feature_id 存在但未传 is_recurring 返回 feature_task', () => {
    expect(determineExecutionMode({ input: 'some task', feature_id: 'f-2' })).toBe('feature_task');
  });

  it('无 feature_id 无 is_recurring 返回 cecelia（Cecelia 派发模式）', () => {
    expect(determineExecutionMode({ input: '修复登录 bug' })).toBe('cecelia');
  });

  it('无 feature_id 无 input 返回 cecelia', () => {
    expect(determineExecutionMode({})).toBe('cecelia');
  });

  it('is_recurring 优先于 feature_id', () => {
    // 两者都为 truthy，is_recurring 优先
    expect(determineExecutionMode({ feature_id: 'f-3', is_recurring: true })).toBe('recurring');
  });
});

// ============================================================
// routeTaskCreate - 完整结构和各 task_type
// ============================================================

describe('routeTaskCreate - 结果结构完整性', () => {
  it('包含所有必要字段', () => {
    const result = routeTaskCreate({ title: 'implement feature', task_type: 'dev' });
    expect(result).toHaveProperty('location');
    expect(result).toHaveProperty('execution_mode');
    expect(result).toHaveProperty('task_type');
    expect(result).toHaveProperty('skill');
    expect(result).toHaveProperty('routing_reason');
  });

  it('routing_reason 字符串包含 task_type 和 location', () => {
    const result = routeTaskCreate({ title: 'write tests', task_type: 'qa' });
    expect(result.routing_reason).toContain('task_type=qa');
    expect(result.routing_reason).toContain('location=us');
  });
});

describe('routeTaskCreate - task_type → skill + location 映射', () => {
  const cases = [
    { task_type: 'dev',                location: 'us', skill: '/dev' },
    { task_type: 'review',             location: 'us', skill: '/code-review' },
    { task_type: 'talk',               location: 'xian', skill: '/cecelia' },
    { task_type: 'data',               location: 'xian', skill: '/sync-hk' },
    { task_type: 'qa',                 location: 'us', skill: '/code-review' },
    { task_type: 'audit',              location: 'us', skill: '/code-review' },
    { task_type: 'research',           location: 'xian', skill: '/research' },
    { task_type: 'explore',            location: 'xian', skill: '/explore' },
    { task_type: 'knowledge',          location: 'xian', skill: '/knowledge' },
    { task_type: 'dept_heartbeat',     location: 'us',   skill: '/cecelia' },
    { task_type: 'architecture_design',location: 'us',   skill: '/architect design' },
    { task_type: 'architecture_scan',  location: 'us',   skill: '/architect scan' },
    { task_type: 'arch_review',        location: 'xian', skill: '/arch-review review' },
    { task_type: 'initiative_verify',  location: 'us',   skill: '/arch-review verify' },
  ];

  for (const { task_type, location, skill } of cases) {
    it(`task_type=${task_type} → location=${location}, skill=${skill}`, () => {
      const result = routeTaskCreate({ title: 'test task', task_type });
      expect(result.location).toBe(location);
      expect(result.skill).toBe(skill);
      expect(result.task_type).toBe(task_type);
    });
  }
});

describe('routeTaskCreate - 默认值行为', () => {
  it('不提供 task_type 时默认为 dev', () => {
    const result = routeTaskCreate({ title: 'some task' });
    expect(result.task_type).toBe('dev');
    expect(result.skill).toBe('/dev');
    expect(result.location).toBe('us');
  });

  it('未知 task_type 时 skill 回退到 /dev', () => {
    const result = routeTaskCreate({ title: 'mystery task', task_type: 'nonexistent' });
    expect(result.skill).toBe('/dev');
  });
});

describe('routeTaskCreate - execution_mode 决策', () => {
  it('is_recurring=true 时 execution_mode=recurring', () => {
    const result = routeTaskCreate({ title: 'daily standup', task_type: 'talk', is_recurring: true });
    expect(result.execution_mode).toBe('recurring');
  });

  it('feature_id 存在时 execution_mode=feature_task', () => {
    const result = routeTaskCreate({ title: 'sub task', task_type: 'dev', feature_id: 'feat-001' });
    expect(result.execution_mode).toBe('feature_task');
  });

  it('普通任务 execution_mode=cecelia', () => {
    const result = routeTaskCreate({ title: 'implement X', task_type: 'dev' });
    expect(result.execution_mode).toBe('cecelia');
  });
});

// ============================================================
// getLocationsForTaskTypes - 批量路由
// ============================================================

describe('getLocationsForTaskTypes', () => {
  it('批量返回多个 task_type 的 location 映射', () => {
    const result = getLocationsForTaskTypes(['dev', 'talk', 'research', 'data']);
    expect(result.dev).toBe('us');
    expect(result.talk).toBe('xian');
    expect(result.research).toBe('xian');
    expect(result.data).toBe('xian');
  });

  it('空数组返回空对象', () => {
    const result = getLocationsForTaskTypes([]);
    expect(result).toEqual({});
  });

  it('包含未知 task_type 时返回 DEFAULT_LOCATION', () => {
    const result = getLocationsForTaskTypes(['unknown_type']);
    expect(result.unknown_type).toBe(DEFAULT_LOCATION);
  });

  it('返回对象的 key 数量与输入数组长度一致', () => {
    const types = ['dev', 'qa', 'audit', 'explore'];
    const result = getLocationsForTaskTypes(types);
    expect(Object.keys(result)).toHaveLength(types.length);
  });
});

// ============================================================
// isValidLocation
// ============================================================

describe('isValidLocation', () => {
  it('us 是合法 location', () => {
    expect(isValidLocation('us')).toBe(true);
  });

  it('hk 已废弃，不再是合法 location（HK MiniMax 已移除）', () => {
    expect(isValidLocation('hk')).toBe(false);
  });

  it('大写 US 也合法（大小写不敏感）', () => {
    expect(isValidLocation('US')).toBe(true);
  });

  it('大写 HK 已废弃，不再合法', () => {
    expect(isValidLocation('HK')).toBe(false);
  });

  it('任意其他字符串非法', () => {
    expect(isValidLocation('eu')).toBe(false);
    expect(isValidLocation('sg')).toBe(false);
    expect(isValidLocation('')).toBe(false);
  });

  it('null / undefined 非法', () => {
    expect(isValidLocation(null)).toBe(false);
    expect(isValidLocation(undefined)).toBe(false);
  });

  it('xian_m1 是合法 location（西安M1 独立路由节点）', () => {
    expect(isValidLocation('xian_m1')).toBe(true);
  });

  it('大写 XIAN_M1 也合法（大小写不敏感）', () => {
    expect(isValidLocation('XIAN_M1')).toBe(true);
  });
});

// ============================================================
// isValidTaskType - 基础边界（不重复其他文件中已有的单类型断言）
// ============================================================

describe('isValidTaskType - 完整覆盖检查', () => {
  it('VALID_TASK_TYPES 中每个类型都通过验证', () => {
    for (const t of VALID_TASK_TYPES) {
      expect(isValidTaskType(t)).toBe(true);
    }
  });

  it('大小写不敏感：AUDIT 合法', () => {
    expect(isValidTaskType('AUDIT')).toBe(true);
  });

  it('非法类型返回 false', () => {
    expect(isValidTaskType('nonexistent')).toBe(false);
    expect(isValidTaskType(null)).toBe(false);
    expect(isValidTaskType(undefined)).toBe(false);
    expect(isValidTaskType('')).toBe(false);
  });
});

// ============================================================
// getValidTaskTypes
// ============================================================

describe('getValidTaskTypes', () => {
  it('返回数组，包含所有 LOCATION_MAP 的 key', () => {
    const types = getValidTaskTypes();
    for (const key of Object.keys(LOCATION_MAP)) {
      expect(types).toContain(key);
    }
  });

  it('结果长度等于 LOCATION_MAP 的条目数', () => {
    expect(getValidTaskTypes()).toHaveLength(Object.keys(LOCATION_MAP).length);
  });
});

// ============================================================
// LOCATION_MAP 完整性断言
// ============================================================

describe('LOCATION_MAP 完整性', () => {
  it('所有 value 只能是 us、xian、xian_m1 或 cn', () => {
    for (const [type, loc] of Object.entries(LOCATION_MAP)) {
      expect(['us', 'xian', 'xian_m1', 'cn'], `task_type=${type} location 非法`).toContain(loc);
    }
  });

  it('LOCATION_MAP 包含 architecture_design', () => {
    expect(LOCATION_MAP).toHaveProperty('architecture_design');
    expect(LOCATION_MAP.architecture_design).toBe('us');
  });

  it('LOCATION_MAP 中通用任务路由到 xian（不再路由到 hk）', () => {
    expect(LOCATION_MAP.talk).toBe('xian');
    expect(LOCATION_MAP.research).toBe('xian');
    expect(LOCATION_MAP.data).toBe('xian');
    expect(LOCATION_MAP.explore).toBe('xian');
  });
});

// ============================================================
// SKILL_WHITELIST 完整性断言
// ============================================================

describe('SKILL_WHITELIST 完整性', () => {
  it('所有 skill 值以 / 开头', () => {
    for (const [type, skill] of Object.entries(SKILL_WHITELIST)) {
      expect(skill, `task_type=${type} skill 不以 / 开头`).toMatch(/^\//);
    }
  });

  it('architecture_design → /architect design', () => {
    expect(SKILL_WHITELIST.architecture_design).toBe('/architect design');
  });

  it('talk → /cecelia', () => {
    expect(SKILL_WHITELIST.talk).toBe('/cecelia');
  });

  it('dept_heartbeat → /cecelia', () => {
    expect(SKILL_WHITELIST.dept_heartbeat).toBe('/cecelia');
  });

  it('data → /sync-hk', () => {
    expect(SKILL_WHITELIST.data).toBe('/sync-hk');
  });

  it('explore → /explore', () => {
    expect(SKILL_WHITELIST.explore).toBe('/explore');
  });

  it('knowledge → /knowledge', () => {
    expect(SKILL_WHITELIST.knowledge).toBe('/knowledge');
  });

  it('research → /research', () => {
    expect(SKILL_WHITELIST.research).toBe('/research');
  });

  it('audit → /code-review（audit 复用 code-review skill）', () => {
    expect(SKILL_WHITELIST.audit).toBe('/code-review');
  });

  it('qa → /code-review（qa 复用 code-review skill）', () => {
    expect(SKILL_WHITELIST.qa).toBe('/code-review');
  });
});

// ============================================================
// DEFAULT_LOCATION
// ============================================================

describe('DEFAULT_LOCATION', () => {
  it('默认 location 为 us', () => {
    expect(DEFAULT_LOCATION).toBe('us');
  });
});

// ============================================================
// SINGLE_TASK_PATTERNS / FEATURE_PATTERNS 存在性
// ============================================================

describe('SINGLE_TASK_PATTERNS / FEATURE_PATTERNS 导出', () => {
  it('SINGLE_TASK_PATTERNS 是非空数组', () => {
    expect(Array.isArray(SINGLE_TASK_PATTERNS)).toBe(true);
    expect(SINGLE_TASK_PATTERNS.length).toBeGreaterThan(0);
  });

  it('FEATURE_PATTERNS 是非空数组', () => {
    expect(Array.isArray(FEATURE_PATTERNS)).toBe(true);
    expect(FEATURE_PATTERNS.length).toBeGreaterThan(0);
  });

  it('SINGLE_TASK_PATTERNS 每个元素都是 RegExp', () => {
    for (const p of SINGLE_TASK_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  it('FEATURE_PATTERNS 每个元素都是 RegExp', () => {
    for (const p of FEATURE_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});
