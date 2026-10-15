// Acorn 只负责完整语法解析；此处逐节点证明有限读取/断言无浏览器副作用。
// 未知节点/调用/绑定一律拒绝，不通过删除字符串或执行待判定程序来猜测安全性。
import { parse } from 'acorn';
import { readonlyQaScript } from './readonly-qa-command.mjs';

const RESERVED = new Set(['require', 'JSON', 'console', 'Error', 'eval', 'Function', 'process', 'global', 'globalThis']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
const TEXT_PATH = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:md|mjs|json)$/;
const isId = (node, name) => node?.type === 'Identifier' && node.name === name;
const literal = (node) => node?.type === 'Literal' && typeof node.value === 'string' && !node.regex;
const bad = () => { throw new Error('readonly_qa_unknown'); };

function member(node) {
  if (node?.type !== 'MemberExpression' || node.optional) return null;
  const key = node.computed ? literal(node.property) ? node.property.value : null
    : node.property.type === 'Identifier' ? node.property.name : null;
  return key !== null && !FORBIDDEN_KEYS.has(key) ? key : null;
}

function inspect(program) {
  const bindings = new Map();
  const staticStrings = new Map(); // 仅已见 const 的直接 Literal；不传播别名/拼接或循环变量。
  let reads = 0;
  let assertions = 0;
  const truthy = type => type === 'boolean' || type === 'json';
  function staticPath(node, scope) {
    if (literal(node)) return node.value;
    return node?.type === 'Identifier' && scope.get(node.name) === 'string'
      ? staticStrings.get(node.name) : undefined;
  }
  function fresh(node, scope) {
    if (node?.type !== 'Identifier' || RESERVED.has(node.name) || scope.has(node.name)) bad();
    return node.name;
  }
  function infer(node, scope) {
    if (!node) return bad();
    if (node.type === 'Literal') {
      if (node.regex || node.bigint || !['string', 'boolean', 'number'].includes(typeof node.value) && node.value !== null) bad();
      return node.value === null ? 'null' : typeof node.value;
    }
    if (node.type === 'Identifier') return scope.get(node.name) ?? bad();
    if (node.type === 'MemberExpression') {
      if (member(node) === null || infer(node.object, scope) !== 'json') bad();
      return 'json'; // JSON.parse 的数据没有 getter/函数；禁止原型入口。
    }
    if (node.type === 'UnaryExpression' && node.operator === '!') {
      if (!truthy(infer(node.argument, scope))) bad();
      return 'boolean';
    }
    if (node.type === 'BinaryExpression') {
      const left = infer(node.left, scope), right = infer(node.right, scope);
      if (node.operator === '+' && left === 'string' && right === 'string') return 'string';
      if (['===', '!=='].includes(node.operator) && left !== 'fs' && right !== 'fs') return 'boolean';
      bad();
    }
    if (node.type === 'LogicalExpression' && ['||', '&&'].includes(node.operator)) {
      if (infer(node.left, scope) !== 'boolean' || infer(node.right, scope) !== 'boolean') bad();
      return 'boolean';
    }
    if (node.type !== 'CallExpression' || node.optional || node.arguments.some(a => a.type === 'SpreadElement')) bad();
    const args = node.arguments;
    const callee = node.callee;
    const key = member(callee);
    if (isId(callee, 'require') && args.length === 1 && literal(args[0]) && args[0].value === 'fs') return 'fs';
    if (key === 'readFileSync' && callee.object?.type === 'Identifier'
      && scope.get(callee.object.name) === 'fs') {
      const file = staticPath(args[0], scope);
      if (args.length !== 2 || typeof file !== 'string' || !TEXT_PATH.test(file)
        || file.split('/').some(p => p === '.' || p === '..' || p.startsWith('.'))
        || !literal(args[1]) || args[1].value !== 'utf8') bad();
      reads++;
      return 'string';
    }
    if (key === 'parse' && isId(callee.object, 'JSON')) {
      if (args.length !== 1 || infer(args[0], scope) !== 'string') bad();
      return 'json';
    }
    if (key === 'includes' && infer(callee.object, scope) === 'string') {
      if (args.length !== 1 || infer(args[0], scope) !== 'string') bad();
      return 'boolean';
    }
    if (key === 'find' && infer(callee.object, scope) === 'json') {
      const fn = args[0];
      if (args.length !== 1 || fn?.type !== 'ArrowFunctionExpression' || fn.async || !fn.expression || fn.params.length !== 1) bad();
      const local = new Map(scope);
      local.set(fresh(fn.params[0], scope), 'json');
      if (infer(fn.body, local) !== 'boolean') bad();
      return 'json';
    }
    bad();
  }
  function statement(node, scope) {
    if (node.type === 'VariableDeclaration' && node.kind === 'const') {
      for (const decl of node.declarations) {
        const name = fresh(decl.id, scope);
        scope.set(name, infer(decl.init, scope));
        if (literal(decl.init)) staticStrings.set(name, decl.init.value);
      }
      return;
    }
    if (node.type === 'ForOfStatement' && !node.await && node.left.type === 'VariableDeclaration'
      && node.left.kind === 'const' && node.left.declarations.length === 1 && !node.left.declarations[0].init) {
      if (node.right.type !== 'ArrayExpression' || !node.right.elements.length || !node.right.elements.every(literal)) bad();
      const local = new Map(scope);
      local.set(fresh(node.left.declarations[0].id, scope), 'string');
      if (node.body.type !== 'IfStatement') bad();
      statement(node.body, local);
      return;
    }
    if (node.type === 'IfStatement' && !node.alternate && truthy(infer(node.test, scope))) {
      const error = node.consequent.type === 'ThrowStatement' ? node.consequent.argument : null;
      if (error?.type !== 'CallExpression' || !isId(error.callee, 'Error') || error.optional
        || error.arguments.length !== 1 || infer(error.arguments[0], scope) !== 'string') bad();
      assertions++;
      return;
    }
    if (node.type === 'ExpressionStatement') {
      const call = node.expression;
      if (call.type !== 'CallExpression' || call.optional || member(call.callee) !== 'log'
        || !isId(call.callee.object, 'console') || call.arguments.length !== 1 || !literal(call.arguments[0])) bad();
      return;
    }
    bad();
  }
  for (const node of program.body) statement(node, bindings);
  return reads > 0 && assertions > 0;
}

export function isReadonlyQaCommand(command, { allowHealthPrefix = true } = {}) {
  const source = readonlyQaScript(command, { allowHealthPrefix });
  if (source === null) return false;
  try {
    const comments = [];
    const tree = parse(source, { ecmaVersion: 2022, sourceType: 'script', allowHashBang: false, onComment: comments });
    return comments.length === 0 && inspect(tree);
  } catch { return false; }
}
