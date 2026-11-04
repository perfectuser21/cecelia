import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { DB_WHITELISTED_TASK_TYPES } from '../../lib/task-type-registry.js';
import { scanFile } from './task-type-registry.lexical.lib.js';

export const EXECUTOR_HANDLER_SITE = 'ast:program:const:_TASK_ROUTES:handlers';
const taskTypes = new Set(DB_WHITELISTED_TASK_TYPES);

function walkNodes(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walkNodes(child, visit));
    else if (value && typeof value === 'object') walkNodes(value, visit);
  }
}

function isHandler(value, key, functions) {
  if (value.type === 'Identifier') return functions.has(value.name);
  // 现役包装器形状：(task) => 本地函数(task, 当前task_type)。不放行字符串、
  // 不明引用或任意表达式，仅验证函数映射结构，不执行executor或handler。
  if (value.type !== 'ArrowFunctionExpression' || value.async || value.params.length !== 1
    || value.params[0].type !== 'Identifier' || value.body.type !== 'CallExpression') return false;
  const call = value.body;
  return !call.optional && call.callee.type === 'Identifier' && functions.has(call.callee.name)
    && call.arguments.length === 2 && call.arguments[0].type === 'Identifier'
    && call.arguments[0].name === value.params[0].name
    && call.arguments[1].type === 'Literal' && call.arguments[1].value === key;
}

function executorHandlerHit(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const bindings = [];
  walkNodes(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
      && node.id.name === '_TASK_ROUTES') bindings.push(node);
  });
  if (bindings.length !== 1) return null;
  const declaration = ast.body.find((node) => node.type === 'VariableDeclaration'
    && node.kind === 'const' && node.declarations.length === 1 && node.declarations[0] === bindings[0]);
  const object = declaration?.declarations[0].init;
  if (object?.type !== 'ObjectExpression' || object.properties.length < 2) return null;
  const functions = new Set(ast.body
    .map((node) => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .filter((node) => node?.type === 'FunctionDeclaration').map((node) => node.id.name));
  const keys = new Set();
  for (const property of object.properties) {
    if (property.type !== 'Property' || property.kind !== 'init' || property.computed
      || property.method || property.shorthand) return null;
    const key = property.key.type === 'Identifier' ? property.key.name
      : property.key.type === 'Literal' ? property.key.value : null;
    if (!taskTypes.has(key) || keys.has(key) || !isHandler(property.value, key, functions)) return null;
    keys.add(key);
  }
  return `${object.loc.start.line}:_TASK_ROUTES`;
}

// 只把executor唯一程序级const handler对象的那一条命中改成稳定身份；
// 其它行、其它文件、其它对象/数组/SQL全部保留原词法命中与原许可语义。
export function scanGuardFile(absPath, relativePath) {
  const hits = scanFile(absPath);
  if (relativePath !== 'executor.js') return hits;
  const approvedHit = executorHandlerHit(readFileSync(absPath, 'utf8'));
  if (!approvedHit || hits.filter((hit) => hit === approvedHit).length !== 1) return hits;
  return hits.map((hit) => hit === approvedHit ? EXECUTOR_HANDLER_SITE : hit);
}
