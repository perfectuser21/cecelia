/** 只证明固定Git内nightly实际选择的workspace测试；源码依赖仍由原生扫描器解析。 */
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
const WORKFLOW = '.github/workflows/nightly-regression.yml';
const fail = () => { throw Error('workspace_selector_unproven'); };
const key = property => property.key?.name ?? property.key?.value;
function property(object, name, required = true) {
  if (object?.type !== 'ObjectExpression' || object.properties.some(p => p.type !== 'Property' || p.computed || p.kind !== 'init')) fail();
  const matches = object.properties.filter(p => key(p) === name);
  if (matches.length > 1 || required && matches.length !== 1) fail();
  return matches[0]?.value;
}
function literals(node) {
  if (node?.type !== 'ArrayExpression' || node.elements.some(n => n?.type !== 'Literal' || typeof n.value !== 'string')) fail();
  return node.elements.map(n => n.value);
}
// 现行配置用到的有限glob语法；新语法必须显式重审。
function glob(pattern) {
  if (!pattern || pattern.startsWith('/') || pattern.split('/').some(p => p === '..' || p === '.') || /[\\\0]/.test(pattern)) fail();
  let result = '';
  for (let i = 0; i < pattern.length;) {
    const rest = pattern.slice(i);
    if (rest.startsWith('**/')) { result += '(?:[^/]+/)*'; i += 3; }
    else if (rest === '**') { result += '.*'; i += 2; }
    else if (rest.startsWith('**')) fail();
    else if (rest[0] === '*') { result += '[^/]*'; i++; }
    else if (rest[0] === '{') {
      const group = rest.match(/^\{([a-zA-Z0-9_-]+(?:,[a-zA-Z0-9_-]+)+)\}/);
      if (!group) fail();
      result += `(?:${group[1].split(',').join('|')})`; i += group[0].length;
    } else if (rest[0] === '.') { result += '\\.'; i++; }
    else if (/^[a-zA-Z0-9_/@-]$/.test(rest[0])) { result += rest[0]; i++; }
    else fail();
  }
  return new RegExp(`^${result}$`);
}
function selectors(text, parse) {
  const program = parse(text);
  const imports = program.body.filter(n => n.type === 'ImportDeclaration' && n.source.value === 'vitest/config');
  if (imports.length !== 1 || !imports[0].specifiers.some(n => n.type === 'ImportSpecifier' && n.imported.name === 'defineConfig' && n.local.name === 'defineConfig')) fail();
  if (program.body.some(n => !['ImportDeclaration', 'VariableDeclaration', 'ExportDefaultDeclaration'].includes(n.type))) fail();
  const exported = program.body.filter(n => n.type === 'ExportDefaultDeclaration');
  const config = exported[0]?.declaration;
  if (exported.length !== 1 || config?.type !== 'CallExpression' || config.callee.name !== 'defineConfig' || config.arguments.length !== 1) fail();
  const test = property(config.arguments[0], 'test');
  for (const name of ['root', 'workspace', 'projects']) if (property(config.arguments[0], name, false)) fail();
  for (const name of ['root', 'dir', 'workspace', 'projects']) if (property(test, name, false)) fail();
  const include = literals(property(test, 'include')).map(glob);
  const exclude = property(test, 'exclude', false);
  // Vitest默认排除目录，以及当前API显式排除目录；都不能成为测试来源。
  return { include, exclude: exclude ? literals(exclude).map(glob) : [] };
}
export function workspaceSelectorEnabled(text, parse) {
  const list = parse(text).body.filter(n => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration')
    .flatMap(n => n.declaration.declarations.filter(d => d.id?.name === 'EXISTING_OPS_WORKSPACE_SELECTOR_SCHEMA').map(d => ({ parent: n.declaration, value: d.init })));
  if (!list.length) return false;
  if (list.length !== 1 || list[0].parent.kind !== 'const' || list[0].value?.type !== 'Literal' || ![0, 1].includes(list[0].value.value)) fail();
  return list[0].value.value === 1;
}
export async function collectWorkspaceSources({ nightly, parse, paths, read, revision, relations, requireProof }) {
  const doc = yaml.load(nightly), job = doc?.jobs?.['workspace-test-nightly'];
  const environment = !doc.env || Object.keys(doc.env).every(name => name === 'CODEX_RELAY_HOME');
  if (!requireProof(Boolean(job && environment && !doc.defaults && !job.defaults && job.if === undefined && job.env === undefined && !job.container && !job['continue-on-error']), 'nightly_workspace_job_unproven')) return;
  for (const workspace of ['api', 'dashboard']) {
    const prefix = `apps/${workspace}/`, config = `${prefix}vitest.config.ts`, manifest = `${prefix}package.json`;
    const command = workspace === 'api' ? 'npm test' : 'npx vitest run';
    const step = job.steps?.find(s => s.run?.trim() === `cd apps/${workspace} && npm ci && ${command}`);
    if (!requireProof(Boolean(step && step.if === undefined && step.env === undefined && step.shell === undefined && step['working-directory'] === undefined && !step['continue-on-error']), 'nightly_workspace_command_unproven')) continue;
    const packageText = await read(manifest), configText = await read(config);
    if (!packageText || !configText) continue;
    const pkg = JSON.parse(packageText);
    if (!requireProof(Boolean(pkg.devDependencies?.vitest && !pkg.scripts?.pretest && !pkg.scripts?.posttest &&
      (workspace !== 'api' || pkg.scripts?.test === "NODE_OPTIONS='--max-old-space-size=2048' vitest run")), 'workspace_vitest_entry_unproven')) continue;
    const selected = selectors(configText, parse);
    relations.push({ consumer_path: WORKFLOW, input_path: manifest, kind: 'nightly_workspace_package', revision },
      { consumer_path: WORKFLOW, input_path: config, kind: 'nightly_workspace_vitest_config', revision });
    for (const path of paths.filter(p => p.startsWith(prefix) && /\.(?:test|spec)\.(?:ts|tsx)$/.test(p))) {
      const relative = path.slice(prefix.length);
      const ancestors = relative.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'));
      // 只认默认排除集以外的保守子集；不以文件存在推断cypress/config测试被执行。
      if (relative.split('/').some(part => part.startsWith('.') || ['node_modules', 'dist', 'cypress'].includes(part)) ||
        /(?:^|\/)(?:karma|rollup|webpack|vite|vitest|jest|ava|babel|nyc|cypress|tsup|build|eslint|prettier)\.config\./.test(relative) ||
        !selected.include.some(p => p.test(relative)) || selected.exclude.some(p => p.test(relative) || ancestors.some(parent => p.test(parent)))) continue;
      if (await read(path)) relations.push({ consumer_path: config, input_path: path, kind: 'literal_workspace_vitest_selector', revision });
    }
  }
}

/** 图解析能力独立于definition协议：旧定义字节不变，只解析两侧各自真实固定Git输入。 */
export async function collectWorkspaceInputEdges({ revision, paths, readSource, parse }) {
  const unknown = () => { throw Object.assign(Error('workspace input source unproven'), { code: 'WORKSPACE_INPUT_SOURCE_UNPROVEN' }); };
  if (!/^[a-f0-9]{40}$/.test(revision) || !Array.isArray(paths) || typeof readSource !== 'function') unknown();
  if (!paths.includes(WORKFLOW)) return [];
  const contents = new Map(), relations = [];
  const read = async path => {
    if (!paths.includes(path)) unknown();
    const text = await readSource(path, revision);
    if (typeof text !== 'string' || !text.trim()) unknown();
    contents.set(path, createHash('sha256').update(text).digest('hex'));
    return text;
  };
  try {
    const nightly = await read(WORKFLOW);
    if (!yaml.load(nightly)?.jobs?.['workspace-test-nightly']) return [];
    await collectWorkspaceSources({ nightly, parse, paths, read, revision, relations, requireProof: condition => {
      if (!condition) unknown();
      return true;
    } });
  } catch { unknown(); }
  return relations.map(row => ({ src_path: row.consumer_path, dst_path: row.input_path, edge_type: 'import', detail: {
    via: 'fixed_git_workspace_input', selector_kind: row.kind, source_revision: revision,
    consumer_sha256: contents.get(row.consumer_path), input_sha256: contents.get(row.input_path), selector_schema: 1,
  } }));
}
