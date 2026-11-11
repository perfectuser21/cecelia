import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const keyring = '/usr/share/keyrings/ubuntu-archive-keyring.gpg';
const sourceFile = '/etc/apt/sources.list.d/ubuntu.sources';
const indirect = uri => /^mirror\+file:\/etc\/apt\/apt-mirrors(?:-security)?\.txt$/.test(uri)
  || /^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?$/.test(uri);
const official = uri => /^https?:\/\/(?:archive|security)\.ubuntu\.com\/ubuntu\/?$/.test(uri);

export function prepareUbuntuSources(text) {
  let ubuntu = 0;
  const result = text.split(/(\r?\n[ \t]*\r?\n)/).map(paragraph => {
    const entries = [...paragraph.matchAll(/^([A-Za-z][A-Za-z-]*):[ \t]*([^\r\n]*)/gm)];
    const fields = Object.fromEntries(entries.map(match => [match[1], match[2].trim()]));
    const uris = fields.URIs?.split(/\s+/) ?? [];
    if (fields['Signed-By'] !== keyring && !uris.some(uri => indirect(uri) || official(uri))) return paragraph;
    ubuntu++;
    if (new Set(entries.map(match => match[1])).size !== entries.length
      || /^[ \t]+\S/m.test(paragraph)
      || ['Types', 'URIs', 'Suites', 'Components'].some(field => !fields[field])
      || fields['Signed-By'] !== keyring) throw Error('ubuntu_source_format_unsupported');
    if (!uris.every(uri => indirect(uri) || official(uri))) throw Error('ubuntu_source_uri_unsupported');
    const security = fields.Suites.split(/\s+/).map(suite => suite.endsWith('-security'));
    if (security.some(Boolean) && !security.every(Boolean)) throw Error('ubuntu_source_security_suites_mixed');
    const archive = `https://${security[0] ? 'security' : 'archive'}.ubuntu.com/ubuntu`;
    if (!uris.some(indirect)) return paragraph;
    return paragraph.replace(/^(URIs:[ \t]*)([^\r\n]*)/m,
      (_, prefix) => prefix + uris.map(uri => indirect(uri) ? archive : uri).join(' '));
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
  assertHostedUbuntu(process.env, process.platform, fs.readFileSync('/etc/os-release', 'utf8'));
  if (!fs.lstatSync(sourceFile).isFile()) throw Error('ubuntu_source_regular_file_required');
  const before = fs.readFileSync(sourceFile, 'utf8');
  const after = prepareUbuntuSources(before);
  if (after !== before) {
    const write = spawnSync('sudo', ['tee', sourceFile], { input: after, stdio: ['pipe', 'ignore', 'inherit'] });
    if (write.error || write.status !== 0) throw Error('ubuntu_source_write_failed');
    if (fs.readFileSync(sourceFile, 'utf8') !== after) throw Error('ubuntu_source_readback_failed');
  }
  console.log('Ubuntu official package archives prepared; signatures and suites preserved.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
