// 这些测试核验固定外置Skill正文；原生路由、Runner和launcher测试仍在组件单测中。
export const SKILL_SOURCE_ROOTS = {brain:'packages/brain', root:'.'};
export const SKILL_SOURCE_TESTS = {
  brain: [
    '**/*.skill-source.test.*',
  ],
  root: ['tests/**/*.skill-source.test.*'],
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
