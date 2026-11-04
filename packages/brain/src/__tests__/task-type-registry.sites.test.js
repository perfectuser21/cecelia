import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { scanGuardFile, EXECUTOR_HANDLER_SITE } from './helpers/task-type-registry.sites.lib.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const executor = readFileSync(join(SRC, 'executor.js'), 'utf8');
const ast = parse(executor, { ecmaVersion: 'latest', sourceType: 'module' });
const declaration = ast.body.find((node) => node.type === 'VariableDeclaration'
  && node.declarations.some((d) => d.id.name === '_TASK_ROUTES'));
const routes = declaration.declarations[0].init;
const fixtureDirs = [];
afterEach(() => fixtureDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function scan(source, relativePath = 'executor.js') {
  const dir = mkdtempSync(join(tmpdir(), 'task-type-sites-'));
  fixtureDirs.push(dir);
  const file = join(dir, 'executor.js');
  writeFileSync(file, source);
  return scanGuardFile(file, relativePath);
}
function replaceRoutes(replacement) {
  return executor.slice(0, routes.start) + replacement + executor.slice(routes.end);
}

describe('已审executor handler表的结构身份', () => {
  it('实际唯一路由表在前置空白/注释移动后仍只有一个获准命中', () => {
    const moved = executor.slice(0, declaration.start) + '\n\n/* 安全重排，不改变路由 */\n'
      + executor.slice(declaration.start);
    expect(scan(moved)).toEqual([EXECUTOR_HANDLER_SITE]);
  });

  it('只给executor真实相对路径放行，其它文件的同表仍是手抄命中', () => {
    expect(scan(executor, 'other.js')).not.toContain(EXECUTOR_HANDLER_SITE);
    expect(scan(executor, 'nested/executor.js')).not.toContain(EXECUTOR_HANDLER_SITE);
    expect(scan(executor, 'other.js').some((hit) => hit.endsWith(':_TASK_ROUTES'))).toBe(true);
  });

  it('真实表之外新增数组枚举仍有未获准命中', () => {
    const hits = scan(executor + "\nconst NEW_TYPES = ['dev', 'review', 'qa'];\n");
    expect(hits).toContain(EXECUTOR_HANDLER_SITE);
    expect(hits.filter((hit) => hit !== EXECUTOR_HANDLER_SITE).some((hit) => hit.endsWith(':NEW_TYPES'))).toBe(true);
  });

  it('第二张不同名手抄映射不能被同文件或标识符后缀豁免', () => {
    const hits = scan(executor + "\nconst OTHER_TASK_ROUTES = { dev: 'x', review: 'y', qa: 'z' };\n");
    expect(hits).toContain(EXECUTOR_HANDLER_SITE);
    expect(hits.filter((hit) => hit !== EXECUTOR_HANDLER_SITE).some((hit) => hit.endsWith(':OTHER_TASK_ROUTES'))).toBe(true);
  });

  it('嵌套第二个同名表使唯一身份失效，两个命中均不能获准', () => {
    const hits = scan(executor + '\nfunction duplicate() { const _TASK_ROUTES = { dev: _prepareTalkPrompt, review: _prepareCodeReviewArgs }; }\n');
    expect(hits).not.toContain(EXECUTOR_HANDLER_SITE);
    expect(hits.filter((hit) => hit.endsWith(':_TASK_ROUTES'))).toHaveLength(2);
  });

  it.each([
    ['字符串枚举', "{ dev: 'brain', review: 'brain', qa: 'brain' }"],
    ['数组类型', "['dev', 'review', 'qa']"],
    ['未知函数引用', '{ dev: unknownHandler, review: _prepareCodeReviewArgs }'],
    ['非handler成员', '{ dev: 42, review: _prepareCodeReviewArgs }'],
    ['计算键', "{ ['dev']: _prepareTalkPrompt, review: _prepareCodeReviewArgs }"],
    ['spread结构', '{ ...EXTRA, dev: _prepareTalkPrompt, review: _prepareCodeReviewArgs }'],
    ['未转发任务的包装调用', '{ dev: (t) => _prepareTalkPrompt(other), review: _prepareCodeReviewArgs }'],
    ['重复键', '{ dev: _prepareTalkPrompt, dev: _prepareCodeReviewArgs, review: _prepareCodeReviewArgs }'],
  ])('%s不再满足已审handler表身份', (_label, replacement) => {
    expect(scan(replaceRoutes(replacement))).not.toContain(EXECUTOR_HANDLER_SITE);
  });

  it('只剩嵌套同名handler对象也不能冒充程序级表', () => {
    const nested = executor.slice(0, declaration.start) + 'function nestedOnly() { '
      + executor.slice(declaration.start, declaration.end) + ' }' + executor.slice(declaration.end);
    expect(scan(nested)).not.toContain(EXECUTOR_HANDLER_SITE);
  });

  it('let可重赋值表失去const结构许可', () => {
    const changed = executor.slice(0, declaration.start) + 'let' + executor.slice(declaration.start + 5);
    expect(scan(changed)).not.toContain(EXECUTOR_HANDLER_SITE);
  });

  it('其它历史站点仍保留原始行号命中语义', () => {
    expect(scan("const TYPES = ['dev', 'review'];\n", 'model-profile.js')).toEqual(['1:TYPES']);
    expect(scan("\nconst TYPES = ['dev', 'review'];\n", 'model-profile.js')).toEqual(['2:TYPES']);
  });
});
