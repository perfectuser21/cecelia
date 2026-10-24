// 仅为 dry-run 文档数据分类提供有限证明；不是执行许可或通用 JS 安全分析器。
import { parse } from 'acorn';
import { readonlyQaScript } from './readonly-qa-command.mjs';

const RESERVED = new Set(['require', 'JSON', 'Array', 'String', 'Error', 'console',
  'process', 'global', 'globalThis', 'eval', 'Function']);
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor', '__defineGetter__',
  '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
const TEXT_PATH = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:md|mjs|json)$/;
const fail = () => { throw new Error('doc_data_unproven'); };
const id = (n, name) => n?.type === 'Identifier' && n.name === name;
const key = n => n?.type === 'MemberExpression' && !n.computed && !n.optional
  && n.property.type === 'Identifier' ? n.property.name : null;
const union = (...sets) => new Set(sets.flatMap(s => [...s]));
const value = (type, sig, origins = new Set(), markers = new Set(), constant) =>
  ({ type, sig, origins, markers, constant, refs: new Set(type === 'json' ? [sig] : []), jsonOnly: false });
const predicate = (sig, origins, markers, refs) =>
  ({ ...value('boolean', sig, origins, markers), refs, jsonOnly: true });

function inspect(tree, markers) {
  const reads = new Map(), checkedReads = new Set(), checkedMarkers = new Set();
  const fields = new Map();
  const bindings = new Map();
  let nextRead = 0, assertions = 0;
  const fresh = (n, scope) => {
    if (n?.type !== 'Identifier' || RESERVED.has(n.name) || scope.has(n.name)) fail();
    return n.name;
  };
  const staticString = v => v.type === 'string' && typeof v.constant === 'string';
  const bool = v => {
    if (!['boolean', 'json'].includes(v.type)) fail();
    return v.type === 'json' ? predicate(`truth:${v.sig}`, v.origins, new Set(), v.refs) : v;
  };
  const constant = n => {
    if (n?.type !== 'Literal' || n.regex || n.bigint
      || !['string', 'number', 'boolean'].includes(typeof n.value)) fail();
    if (typeof n.value === 'number' && !Number.isSafeInteger(n.value)) fail();
    return value(typeof n.value, `literal:${JSON.stringify(n.value)}`, new Set(),
      markers.has(n) ? new Set([n]) : new Set(), n.value);
  };
  function infer(n, scope) {
    if (!n) return fail();
    if (n.type === 'Literal') return constant(n);
    if (n.type === 'Identifier') return scope.get(n.name) ?? fail();
    if (n.type === 'MemberExpression' && !n.optional) {
      const object = infer(n.object, scope);
      const field = n.computed ? infer(n.property, scope) : value('string', '', new Set(), new Set(), n.property.name);
      const k = field.constant;
      if (!(typeof k === 'string' && k.length && !BAD_KEYS.has(k)
        || Number.isSafeInteger(k) && k >= 0 && k <= 100)) fail();
      if (object.type === 'parts' && Number.isSafeInteger(k)) {
        return value('string', `${object.sig}[${k}]`, object.origins);
      }
      if (object.type === 'json') {
        const v = value('json', `${object.sig}[${JSON.stringify(k)}]`, object.origins);
        fields.set(v.sig, fields.get(object.sig));
        return v;
      }
      return fail();
    }
    if (n.type === 'UnaryExpression' && n.operator === '!') {
      const v = bool(infer(n.argument, scope));
      return { ...value('boolean', v.sig.startsWith('!') ? v.sig.slice(1) : `!${v.sig}`,
        v.origins, v.markers, v.constant === undefined ? undefined : !v.constant), refs: v.refs, jsonOnly: v.jsonOnly };
    }
    if (n.type === 'BinaryExpression') {
      const a = infer(n.left, scope), b = infer(n.right, scope);
      if (n.operator === '+' && staticString(a) && staticString(b)) {
        if ((a.constant + b.constant).length > 256) fail();
        return value('string', '', new Set(), union(a.markers, b.markers), a.constant + b.constant);
      }
      if (!['===', '!=='].includes(n.operator) || a.type === 'fs' || b.type === 'fs') fail();
      if (a.sig === b.sig || !a.origins.size && !b.origins.size) fail();
      // 不证明两个观测值之间的相关性，只支持 JSON 字段与 primitive 常量。
      if (!(a.type === 'json' && b.constant !== undefined || b.type === 'json' && a.constant !== undefined)) fail();
      return predicate(`${a.sig}${n.operator}${b.sig}`, union(a.origins, b.origins),
        union(a.markers, b.markers), union(a.refs, b.refs));
    }
    if (n.type === 'LogicalExpression' && ['&&', '||'].includes(n.operator)) {
      // 精确的缺值/空数组断言；不是任意同字段逻辑的通行证。
      if (n.operator === '||' && n.left.type === 'UnaryExpression' && n.left.operator === '!'
        && n.right.type === 'LogicalExpression' && n.right.operator === '&&') {
        const array = n.right.left, empty = n.right.right;
        if (array.type === 'CallExpression' && !array.optional && key(array.callee) === 'isArray'
          && id(array.callee.object, 'Array') && array.arguments.length === 1
          && empty.type === 'UnaryExpression' && empty.operator === '!' && key(empty.argument) === 'length') {
          const field = infer(n.left.argument, scope), arrayField = infer(array.arguments[0], scope);
          const lengthField = infer(empty.argument.object, scope);
          if (field.type !== 'json' || field.sig !== arrayField.sig || field.sig !== lengthField.sig) fail();
          return predicate(`missingOrEmpty:${field.sig}`, union(field.origins, arrayField.origins, lengthField.origins),
            new Set(), field.refs);
        }
      }
      const a = bool(infer(n.left, scope)), b = bool(infer(n.right, scope));
      // 常量短路和互补恒真/恒假不能把读文件伪装成可失败断言。
      if (a.constant !== undefined || b.constant !== undefined
        || a.sig === `!${b.sig}` || b.sig === `!${a.sig}`) fail();
      if (!a.jsonOnly || !b.jsonOnly || [...a.refs].some(x => [...b.refs].some(y => {
        if (x === y || x.startsWith(y + '[') || y.startsWith(x + '[')) return true;
        const left = fields.get(x), right = fields.get(y);
        if (!left || !right) return true;
        // 同一个文件的不同提取根不一定独立；不猜 split/parse 的语义等价。
        return left.root !== right.root && [...left.files].some(p => right.files.has(p));
      }))) fail();
      return predicate(`(${a.sig}${n.operator}${b.sig})`, union(a.origins, b.origins),
        union(a.markers, b.markers), union(a.refs, b.refs));
    }
    if (n.type !== 'CallExpression' || n.optional || n.arguments.some(a => a.type === 'SpreadElement')) fail();
    const args = n.arguments, callee = n.callee, method = key(callee);
    if (id(callee, 'require') && args.length === 1 && args[0].type === 'Literal' && args[0].value === 'fs') {
      return value('fs', 'fs');
    }
    if (method === 'readFileSync' && callee.object.type === 'Identifier'
      && scope.get(callee.object.name)?.type === 'fs') {
      if (args.length !== 2) fail();
      const file = infer(args[0], scope), encoding = infer(args[1], scope);
      if (!staticString(file) || !TEXT_PATH.test(file.constant)
        || file.constant.split('/').some(p => p === '.' || p === '..' || p.startsWith('.'))
        || encoding.constant !== 'utf8') fail();
      const read = ++nextRead;
      reads.set(read, file.constant);
      return value('string', `read:${file.constant}`, new Set([read]));
    }
    if (method === 'fromCharCode' && id(callee.object, 'String')) {
      if (args.length !== 1) fail();
      const c = infer(args[0], scope);
      if (c.type !== 'number' || c.constant < 32 || c.constant > 126) fail();
      return value('string', '', new Set(), new Set(), String.fromCharCode(c.constant));
    }
    if (method === 'isArray' && id(callee.object, 'Array')) {
      if (args.length !== 1) fail();
      const v = infer(args[0], scope);
      if (v.type !== 'json' || !v.origins.size) fail();
      return predicate(`array:${v.sig}`, v.origins, new Set(), v.refs);
    }
    if (method === 'parse' && id(callee.object, 'JSON')) {
      if (args.length !== 1) fail();
      const v = infer(args[0], scope);
      if (v.type !== 'string' || !v.origins.size) fail();
      const result = value('json', `json:${v.sig}`, v.origins);
      fields.set(result.sig, { root: result.sig, files: new Set([...v.origins].map(o => reads.get(o))) });
      return result;
    }
    if (method === 'repeat') {
      if (args.length !== 1) fail();
      const v = infer(callee.object, scope), count = infer(args[0], scope);
      if (!staticString(v) || count.type !== 'number' || count.constant < 1 || count.constant > 16
        || v.constant.length * count.constant > 256) fail();
      return value('string', '', new Set(), v.markers, v.constant.repeat(count.constant));
    }
    if (method === 'split') {
      if (args.length !== 1) fail();
      const v = infer(callee.object, scope), separator = infer(args[0], scope);
      if (v.type !== 'string' || !v.origins.size || !staticString(separator)
        || !separator.constant.length || separator.constant.length > 256) fail();
      return value('parts', `split:${v.sig}:${separator.constant}`, v.origins);
    }
    if (method === 'includes') {
      if (args.length !== 1) fail();
      const v = infer(callee.object, scope), word = infer(args[0], scope);
      if (v.type !== 'string' || !v.origins.size || !staticString(word) || !word.constant.length) fail();
      return value('boolean', `includes:${v.sig}:${word.constant}`, v.origins, word.markers);
    }
    fail();
  }
  function statement(n, scope) {
    if (n.type === 'VariableDeclaration' && n.kind === 'const') {
      for (const d of n.declarations) {
        const name = fresh(d.id, scope);
        scope.set(name, infer(d.init, scope));
      }
      return;
    }
    if (n.type === 'ForOfStatement' && !n.await && n.left.type === 'VariableDeclaration'
      && n.left.kind === 'const' && n.left.declarations.length === 1 && !n.left.declarations[0].init
      && n.body.type === 'IfStatement' && n.right.type === 'ArrayExpression'
      && n.right.elements.length > 0 && n.right.elements.length <= 128) {
      const name = fresh(n.left.declarations[0].id, scope);
      for (const e of n.right.elements) {
        const word = constant(e);
        if (!staticString(word) || !word.constant.length || BAD_KEYS.has(word.constant)) fail();
        const local = new Map(scope);local.set(name, word);statement(n.body, local);
      }
      return;
    }
    if (n.type === 'IfStatement' && !n.alternate && n.consequent.type === 'ThrowStatement') {
      const v = bool(infer(n.test, scope)), error = n.consequent.argument;
      if (v.constant !== undefined || !v.origins.size || error?.type !== 'CallExpression'
        || !id(error.callee, 'Error') || error.optional || error.arguments.length !== 1
        || !staticString(infer(error.arguments[0], scope))) fail();
      v.origins.forEach(o => checkedReads.add(o));v.markers.forEach(m => checkedMarkers.add(m));assertions++;
      return;
    }
    if (n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression') {
      const c = n.expression;
      if (!c.optional && key(c.callee) === 'log' && id(c.callee.object, 'console') && c.arguments.length === 1
        && c.arguments[0].type === 'Literal' && typeof c.arguments[0].value === 'string') return;
    }
    fail();
  }
  tree.body.forEach(n => statement(n, bindings));
  return new Set(reads.values()).size >= 2 && assertions > 0
    && [...reads.keys()].every(r => checkedReads.has(r))
    && markers.size > 0 && [...markers].every(m => checkedMarkers.has(m));
}

export function provesMultiFileDocData(command) {
  const source = readonlyQaScript(command, { allowHealthPrefix: false });
  if (source === null || source.length > 65536) return false;
  try {
    const comments = [], tree = parse(source, { ecmaVersion: 2022, sourceType: 'script', onComment: comments });
    if (comments.length) return false;
    const markers = new Set();let nodes = 0;
    function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (++nodes > 10000) fail();
      if (n.type === 'Literal' && typeof n.value === 'string' && /--dry-run\b/.test(n.value)) markers.add(n);
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    }
    walk(tree);
    return inspect(tree, markers);
  } catch { return false; }
}
