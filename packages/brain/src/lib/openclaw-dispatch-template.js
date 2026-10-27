import { openSync, closeSync, fstatSync, readFileSync, constants } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { DISPATCH_DEFAULTS } from './openclaw-dispatch-defaults.js';

function readJson(path, secret = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536
        || (secret && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) throw Error('untrusted_file');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
}
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function inlineToken(v) {
  if (!v || typeof v !== 'object') return false;
  return Object.entries(v).some(([key, value]) => key === 'control_token' || inlineToken(value));
}

/** 模板与凭据分离；不使用归档/旧 JSON 的 token，不把错误内容带到 Notion。 */
export function readDispatchTemplate(dir, file, { secretPath = join(homedir(), '.credentials', 'openclaw-dispatch.json') } = {}) {
  let template;
  try {
    if (typeof file !== 'string' || basename(file) !== file || file.includes('..')
        || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/.test(file)) throw Error('invalid_name');
    template = dir ? readJson(join(dir, file)) : structuredClone(DISPATCH_DEFAULTS[file]);
    if (!object(template) || !/^[a-zA-Z0-9_-]{1,128}$/.test(template.tenant_id ?? '')
        || inlineToken(template) || !object(template.task_request)
        || (template.task_request.tenant_id !== undefined && template.task_request.tenant_id !== template.tenant_id)) {
      throw Error('invalid_template');
    }
  } catch { throw Error('dispatch_template_invalid'); }
  let token;
  try {
    const tokens = readJson(secretPath, true);
    if (!object(tokens) || !Object.hasOwn(tokens, template.tenant_id)) throw Error('unknown_tenant');
    token = tokens[template.tenant_id];
    if (typeof token !== 'string' || !token.trim()) throw Error('empty_token');
  } catch { throw Error('dispatch_credentials_unavailable'); }
  return { ...template, control_token: token };
}
