import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const keyring = '/usr/share/keyrings/ubuntu-archive-keyring.gpg';
const sourceFile = '/etc/apt/sources.list.d/ubuntu.sources';
const archive = 'https://archive.ubuntu.com/ubuntu';
const securityArchive = 'https://security.ubuntu.com/ubuntu';
// 仅识别旧脚本写入的源，以便按suite恢复；不再选择第三方镜像。
const previousMirror = 'https://mirrors.edge.kernel.org/ubuntu';
const indirect = uri => /^mirror\+file:\/etc\/apt\/apt-mirrors(?:-security)?\.txt$/.test(uri)
  || /^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?$/.test(uri);
const official = uri => /^https?:\/\/(?:archive|security)\.ubuntu\.com\/ubuntu\/?$/.test(uri);
const supported = uri => indirect(uri) || official(uri) || uri === previousMirror || uri === previousMirror + '/';

// 拒绝诊断不打印原始行：只有公开Ubuntu域可展示去凭据/query/hash后的结构。
function uriRefusal(code, uri, file, line, field, priority) {
  let detail = { type: 'uri', length: uri.length };
  try {
    const url = new URL(uri);
    if (['http:', 'https:'].includes(url.protocol) && (url.hostname === 'ubuntu.com' || url.hostname.endsWith('.ubuntu.com')))
      detail = { protocol: url.protocol, hostname: url.hostname, pathname: url.pathname };
  } catch {}
  return Error(code + ' ' + JSON.stringify({ file, line, field, ...detail,
    ...(Number.isSafeInteger(priority) ? { priority } : {}) }));
}

// 校验固定runner原生list，不把经过签名验证的多源failover改成单端点。
function validateNativeMirrors(uri, readMirrorList) {
  let text;
  try { text = readMirrorList(uri.slice('mirror+file:'.length)); }
  catch { throw Error('ubuntu_source_mirror_list_unreadable'); }
  if (typeof text !== 'string' || !text.trim() || text.length > 65536) throw Error('ubuntu_source_mirror_list_unsupported');
  const trusted = new Set(['http://azure.archive.ubuntu.com/ubuntu', archive, securityArchive]);
  const seen = new Set();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(\S+)[ \t]+priority:([1-9][0-9]*)$/.exec(line);
    const url = match?.[1].replace(/\/$/, '');
    if (!match || !trusted.has(url)) throw uriRefusal('ubuntu_source_mirror_list_unsupported', line.split(/\s+/)[0], uri.slice('mirror+file:'.length), index + 1, 'mirror_uri', match ? Number(match[2]) : undefined);
    seen.add(url);
  }
  if (!seen.size) throw Error('ubuntu_source_mirror_list_unsupported');
}

export function prepareUbuntuSources(text, { readMirrorList = path => fs.readFileSync(path, 'utf8'), expectedCodename } = {}) {
  let ubuntu = 0, offset = 0;
  let ubuntuCodename;
  const validatedMirrors = new Set();
  const result = text.split(/(\r?\n[ \t]*\r?\n)/).map(paragraph => {
    const start = offset; offset += paragraph.length;
    const entries = [...paragraph.matchAll(/^([A-Za-z][A-Za-z-]*):[ \t]*([^\r\n]*)/gm)];
    const fields = Object.fromEntries(entries.map(match => [match[1], match[2].trim()]));
    const uris = fields.URIs?.split(/\s+/) ?? [];
    if (fields['Signed-By'] !== keyring && !uris.some(supported)) return paragraph;
    ubuntu++;
    if (new Set(entries.map(match => match[1].toLowerCase())).size !== entries.length
      || /^[ \t]+\S/m.test(paragraph)
      || ['Types', 'URIs', 'Suites', 'Components'].some(field => !fields[field])
      || fields['Signed-By'] !== keyring) throw Error('ubuntu_source_format_unsupported');
    const unsupportedURI = uris.find(uri => !supported(uri));
    if (unsupportedURI) throw uriRefusal('ubuntu_source_uri_unsupported', unsupportedURI, sourceFile, text.slice(0, start + entries.find(entry => entry[1] === 'URIs').index).split('\n').length, 'URIs');
    const suites = fields.Suites.split(/\s+/);
    const parsedSuites = suites.map(suite => /^([a-z][a-z0-9]*)(?:-(updates|backports|security))?$/.exec(suite));
    const codename = parsedSuites[0]?.[1];
    if (parsedSuites.some(match => !match || match[1] !== codename)
      || (ubuntuCodename && ubuntuCodename !== codename)
      || (expectedCodename && expectedCodename !== codename)) throw Error('ubuntu_source_suites_unsupported');
    ubuntuCodename = codename;
    const security = suites.map(suite => suite.endsWith('-security'));
    if (security.some(Boolean) && !security.every(Boolean)) throw Error('ubuntu_source_security_suites_mixed');
    for (const uri of uris.filter(uri => uri.startsWith('mirror+file:'))) {
      if (!validatedMirrors.has(uri)) {
        validateNativeMirrors(uri, readMirrorList);
        validatedMirrors.add(uri);
      }
    }
    // 已受信的原生源/直接官方源保留原URL、排序和字段字节。
    if (!uris.some(uri => uri === previousMirror || uri === previousMirror + '/')) return paragraph;
    if (!uris.every(uri => uri === previousMirror || uri === previousMirror + '/')) throw Error('ubuntu_source_uri_unsupported');
    const destination = security.every(Boolean) ? securityArchive : archive;
    if (uris.length === 1 && uris[0] === destination) return paragraph;
    return paragraph.replace(/^(URIs:[ \t]*)([^\r\n]*)/m,
      (_, prefix) => prefix + destination);
  }).join('');
  if (!ubuntu) throw Error('ubuntu_sources_not_found');
  return result;
}

export function assertHostedUbuntu(env, platform, osRelease) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || env.RUNNER_OS !== 'Linux' || platform !== 'linux'
    || !/^ID=(?:ubuntu|"ubuntu")\r?$/m.test(osRelease)) throw Error('github_hosted_ubuntu_required');
}

function main() {
  const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
  assertHostedUbuntu(process.env, process.platform, osRelease);
  const expectedCodename = /^VERSION_CODENAME=["']?([a-z][a-z0-9]*)["']?\r?$/m.exec(osRelease)?.[1];
  if (!expectedCodename) throw Error('ubuntu_source_codename_required');
  if (!fs.lstatSync(sourceFile).isFile()) throw Error('ubuntu_source_regular_file_required');
  const before = fs.readFileSync(sourceFile, 'utf8');
  const after = prepareUbuntuSources(before, { expectedCodename });
  if (after !== before) {
    const write = spawnSync('sudo', ['tee', sourceFile], { input: after, stdio: ['pipe', 'ignore', 'inherit'] });
    if (write.error || write.status !== 0) throw Error('ubuntu_source_write_failed');
    if (fs.readFileSync(sourceFile, 'utf8') !== after) throw Error('ubuntu_source_readback_failed');
  }
  console.log('Ubuntu sources validated; native mirror failover, signatures and suites preserved.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
