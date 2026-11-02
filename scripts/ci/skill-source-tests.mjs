// 这些测试核验固定外置Skill正文；原生路由、Runner和launcher测试仍在组件单测中。
export const SKILL_SOURCE_ROOTS = {brain:'packages/brain', root:'.'};
export const SKILL_SOURCE_TESTS = {
  brain: [
    'scripts/ci/__tests__/skill-contract.test.mjs',
    'src/__tests__/unified-map-consumers.test.js',
    'src/workflows/__tests__/b20-planner-thin-prd-subject.test.js',
    'src/workflows/__tests__/b31-eval-cookie-isolate.test.js',
    'src/workflows/__tests__/harness-contract-validation-identity-skill.test.js',
    'src/workflows/__tests__/planner-role-branch-contract.test.js',
    'src/orchestrator/__tests__/harness-evaluator-required-evidence-skill.test.js',
    'src/orchestrator/__tests__/harness-generator-frozen-baseline-skill.test.js',
    '**/*.skill-source.test.*',
  ],
  root: ['tests/skills/harness-planner-push-noise.test.js', 'tests/**/*.skill-source.test.*'],
};

export const RETIRED_SKILL_TESTS = {};

export function skillSourceExcludes(component) {
  if (!Object.hasOwn(SKILL_SOURCE_TESTS, component)) throw new Error(`未知Skill合同组件：${component}`);
  return [
    ...SKILL_SOURCE_TESTS[component], ...(RETIRED_SKILL_TESTS[component] || []),
    ...(component === 'brain' ? SKILL_SOURCE_TESTS.root.map(path => `../../${path}`) : []),
  ];
}

export function skillSourceConfig(component, base = {}) {
  if (!Object.hasOwn(SKILL_SOURCE_TESTS, component)) throw new Error(`未知Skill合同组件：${component}`);
  return {...base, test: {
    ...base.test, globals: true, environment: 'node', projects: undefined,
    include: SKILL_SOURCE_TESTS[component], exclude: ['**/node_modules/**'],
    fileParallelism: false,
  }};
}
