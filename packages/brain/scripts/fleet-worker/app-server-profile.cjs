'use strict';
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const KEYS = ['image', 'cpus', 'memoryBytes', 'pidsLimit', 'user', 'tmpBytes', 'network', 'homeKey', 'workspaceKey', 'authAccountId', 'hostTools'];
const HASH = /^[a-f0-9]{64}$/;
const DEFAULT_HOST_TOOLS = Object.freeze(['read', 'web_search', 'web_fetch']);
// 业务工具由受保护的部署配置明确选择；此表不含宿主执行或派生代理入口。
const BUSINESS_TOOLS = new Set([...DEFAULT_HOST_TOOLS, 'message', 'memory_search', 'memory_get',
  'sessions_list', 'sessions_history', 'session_status']);
function resolveHostTools(input) {
  if (input === undefined) return DEFAULT_HOST_TOOLS;
  if (!Array.isArray(input) || input.length > 256 || new Set(input).size !== input.length
      || input.some(name => typeof name !== 'string' || !BUSINESS_TOOLS.has(name))) {
    throw new Error('appserver_profile_invalid');
  }
  return Object.freeze([...input].sort());
}

function validateAppServerProfile(profile) {
  if (!profile || Array.isArray(profile) || Object.keys(profile).some(key => !KEYS.includes(key))
      || !/^(?:[a-z0-9][a-z0-9./_-]*@)?sha256:[a-f0-9]{64}$/.test(profile.image)
      || !Number.isFinite(profile.cpus) || profile.cpus <= 0 || profile.cpus > 64
      || !Number.isSafeInteger(profile.memoryBytes) || profile.memoryBytes < 67108864
      || !Number.isSafeInteger(profile.pidsLimit) || profile.pidsLimit < 1 || profile.pidsLimit > 4096
      || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(profile.user)
      || !Number.isSafeInteger(profile.tmpBytes) || profile.tmpBytes < 1048576 || profile.tmpBytes > profile.memoryBytes
      || (profile.network !== 'none' && !/^cecelia-appserver-[a-z0-9-]{1,40}$/.test(profile.network))
      || (profile.authAccountId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(profile.authAccountId))
      || !HASH.test(profile.homeKey) || !HASH.test(profile.workspaceKey)) {
    throw new Error('appserver_profile_invalid');
  }
  const hostTools = resolveHostTools(profile.hostTools);
  return Object.freeze(Object.fromEntries(KEYS.map(key => [key,
    key === 'hostTools' && profile.hostTools !== undefined ? hostTools : profile[key]])));
}

function profileDigest(profile) {
  return createHash('sha256').update(JSON.stringify(validateAppServerProfile(profile))).digest('hex');
}

function loadAppServerProfiles(filename) {
  if (!filename) return Object.freeze({});
  let fd;
  try { fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch { throw new Error('appserver_profiles_permissions'); }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0
        || (stat.uid !== 0 && stat.uid !== process.getuid?.()) || stat.size > 65536) {
      throw new Error('appserver_profiles_permissions');
    }
    const config = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!config || Object.keys(config).some(key => key !== 'profiles') || !config.profiles
        || Array.isArray(config.profiles) || Object.keys(config.profiles).length > 32) {
      throw new Error('appserver_profile_invalid');
    }
    return Object.freeze(Object.fromEntries(Object.entries(config.profiles).map(([name, profile]) => {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('appserver_profile_invalid');
      return [name, validateAppServerProfile(profile)];
    })));
  } finally { fs.closeSync(fd); }
}

function generationOwner(input) {
  return `openclaw-${createHash('sha256').update(JSON.stringify([input.home_key,input.reservation_id,input.intent_id,input.launch_generation])).digest('hex')}`;
}

module.exports = { generationOwner, validateAppServerProfile, profileDigest, loadAppServerProfiles, resolveHostTools, DEFAULT_HOST_TOOLS };
