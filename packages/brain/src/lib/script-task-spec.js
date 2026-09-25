/**
 * script-task-spec.js — executor=script（task_type script_run）的 payload 契约与安全闸
 * （链 bf5088a3 棒 3，任务 5cdbd52a；设计稿 docs/superpowers/specs/2026-09-25-script-executor-design.md）。
 *
 * 契约：{ host, cmd, cwd?, env?, timeout_sec, artifact_paths? }
 *
 * 这是「Brain 让某台机器执行一条命令」的高权限入口，校验全在这里一处：
 *   ① host 只认 machine-registry 里的跑场机（primary/secondary，id 或别名）。调度器（us-vps）、
 *      回环/本机、裸 IP、未注册、非计算机器一律拒绝——us-vps 零执行铁律（决策 96054a8b）。
 *   ② host/cmd/cwd/env/artifact_paths 不许控制字符（换行注入）；cmd 单行、有长度上限。
 *      cmd/cwd/env 值的传输走 base64 stdin，从不拼进 ssh 命令行（见 script-executor 的 runner），
 *      所以引号/美元符这类字符在 cmd 里是合法内容。
 *   ③ env 键白名单（SCRIPT_/TASK_/APP_ 前缀 + 少数通用键）；报错只点名键，绝不回显值。
 *   ④ timeout_sec 必填、整数、1..3600。
 *
 * 校验失败抛 ScriptPayloadError（code=script_payload_invalid）：建单入口映射 400，
 * 派发入口终态 failed（确定性错误，不重试）。纯函数，不碰 DB / 网络。
 */
import { resolveMachineId, machineRoleOf, listComputeWorkerIds, MACHINE_ROLES } from '../machine-registry.js';

export const SCRIPT_TASK_TYPE = 'script_run';
export const SCRIPT_PAYLOAD_INVALID = 'script_payload_invalid';

export const SCRIPT_LIMITS = Object.freeze({
  MAX_TIMEOUT_SEC: 3600,
  MIN_TIMEOUT_SEC: 1,
  MAX_CMD_BYTES: 8192,
  MAX_CWD_BYTES: 1024,
  MAX_ENV_KEYS: 32,
  MAX_ENV_VALUE_BYTES: 4096,
  MAX_ARTIFACTS: 10,
  MAX_ARTIFACT_PATH_BYTES: 1024,
  /** 收割时 stdout 只留尾部 64KB、stderr 尾部 4KB。 */
  MAX_STDOUT_BYTES: 65536,
  MAX_STDERR_BYTES: 4096,
});

/** env 键白名单：命名空间前缀 + 少数通用键。PATH、LD_ 与 DYLD_ 开头的动态库注入键、BASH_ENV、IFS、HOME 等天然不在内。 */
export const SCRIPT_ENV_KEY_PATTERN = /^(?:(?:SCRIPT|TASK|APP)_[A-Z0-9_]{1,56}|TZ|LANG|LC_ALL|CI|NODE_ENV|DEBUG)$/;
export const SCRIPT_ENV_KEY_RULE = 'SCRIPT_/TASK_/APP_ 前缀，或 TZ/LANG/LC_ALL/CI/NODE_ENV/DEBUG';

// 控制字符：C0（含换行 \n、回车 \r、NUL）与 DEL。cmd 额外放行 Tab。
// 匹配控制字符正是本模块的目的（换行注入防线），故显式放行 no-control-regex。
// eslint-disable-next-line no-control-regex
const CONTROL_ANY = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_TAB = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const LOOPBACK = /^(?:localhost|localhost\.localdomain|ip6-localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1?\]?|\[?(?:0{1,4}:){7}0{0,3}1\]?)$/;

export class ScriptPayloadError extends Error {
  constructor(field, message, reason = 'invalid') {
    super(message);
    this.name = 'ScriptPayloadError';
    this.code = SCRIPT_PAYLOAD_INVALID;
    this.field = field;
    this.reason = reason;
  }
}

export function isScriptPayloadError(err) {
  return err?.code === SCRIPT_PAYLOAD_INVALID;
}

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const show = (v) => JSON.stringify(String(v).slice(0, 40));
const fail = (field, message, reason) => { throw new ScriptPayloadError(field, message, reason); };

function checkHost(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    fail('host', 'host 必填，且必须是非空字符串（跑场机的 id 或别名）', 'host_missing');
  }
  const trimmed = raw.trim();
  if (CONTROL_ANY.test(trimmed) || /\s/.test(trimmed)) {
    fail('host', 'host 含控制字符或空白，拒绝（防注入）', 'host_control_chars');
  }
  const lower = trimmed.toLowerCase();
  if (LOOPBACK.test(lower)) {
    fail('host', `host ${show(trimmed)} 是本机/回环地址：脚本只能在跑场机执行，Brain 所在机器零执行（铁律 96054a8b）`, 'host_loopback');
  }
  const id = resolveMachineId(lower);
  if (!id) {
    fail('host', `host ${show(trimmed)} 未在 machine-registry 注册：只允许已注册的跑场机（${listComputeWorkerIds().join(' / ')}）`, 'host_unregistered');
  }
  if (machineRoleOf(id) === MACHINE_ROLES.SCHEDULER) {
    fail('host', `host ${id} 是调度器（scheduler）：us-vps 零执行铁律（决策 96054a8b）禁止在其上跑脚本，请指定跑场机`, 'host_scheduler');
  }
  if (!listComputeWorkerIds().includes(id)) {
    fail('host', `host ${id} 不是跑场机（非 primary/secondary 计算工作机），不可承载脚本执行`, 'host_not_compute_worker');
  }
  return id;
}

function checkCmd(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') fail('cmd', 'cmd 必填，且必须是非空字符串', 'cmd_missing');
  if (CONTROL_EXCEPT_TAB.test(raw)) {
    fail('cmd', 'cmd 含控制字符（换行/回车/NUL 等）：命令须为单行，多步用 && 或 ; 连接', 'cmd_control_chars');
  }
  if (bytes(raw) > SCRIPT_LIMITS.MAX_CMD_BYTES) {
    fail('cmd', `cmd 过长（超过 ${SCRIPT_LIMITS.MAX_CMD_BYTES} 字节）：长脚本请放到跑场机文件里再调用`, 'cmd_too_long');
  }
  return raw;
}

function checkCwd(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw === '') fail('cwd', 'cwd 必须是非空字符串（绝对路径或 ~/ 开头）', 'cwd_invalid');
  if (CONTROL_ANY.test(raw)) fail('cwd', 'cwd 含控制字符，拒绝', 'cwd_control_chars');
  if (bytes(raw) > SCRIPT_LIMITS.MAX_CWD_BYTES) fail('cwd', `cwd 过长（超过 ${SCRIPT_LIMITS.MAX_CWD_BYTES} 字节）`, 'cwd_too_long');
  if (!(raw.startsWith('/') || raw === '~' || raw.startsWith('~/'))) {
    fail('cwd', 'cwd 必须是绝对路径（或 ~ / ~/ 开头）', 'cwd_not_absolute');
  }
  return raw;
}

function checkEnv(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('env', 'env 必须是对象（键值对）', 'env_not_object');
  const keys = Object.keys(raw);
  if (keys.length > SCRIPT_LIMITS.MAX_ENV_KEYS) {
    fail('env', `env 键过多（${keys.length} 个，超过上限 ${SCRIPT_LIMITS.MAX_ENV_KEYS}）`, 'env_too_many');
  }
  const out = {};
  for (const key of keys) {
    if (!SCRIPT_ENV_KEY_PATTERN.test(key)) {
      // 只点名键，绝不回显值（值可能是凭据）。
      fail('env', `env 键 ${show(key)} 不在白名单（允许：${SCRIPT_ENV_KEY_RULE}）`, 'env_key_forbidden');
    }
    const value = raw[key];
    if (typeof value !== 'string') fail('env', `env.${key} 的值必须是字符串`, 'env_value_type');
    if (CONTROL_ANY.test(value)) fail('env', `env.${key} 的值含控制字符（换行等），拒绝`, 'env_value_control_chars');
    if (bytes(value) > SCRIPT_LIMITS.MAX_ENV_VALUE_BYTES) {
      fail('env', `env.${key} 的值过长（超过 ${SCRIPT_LIMITS.MAX_ENV_VALUE_BYTES} 字节）`, 'env_value_too_long');
    }
    out[key] = value;
  }
  return out;
}

function checkTimeout(raw) {
  if (raw === undefined || raw === null) {
    fail('timeout_sec', `timeout_sec 必填（${SCRIPT_LIMITS.MIN_TIMEOUT_SEC}..${SCRIPT_LIMITS.MAX_TIMEOUT_SEC} 的整数秒）：无超时的脚本会永久占住并发槽`, 'timeout_missing');
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    fail('timeout_sec', 'timeout_sec 必须是整数（秒），不接受字符串/小数/Infinity', 'timeout_not_integer');
  }
  if (raw < SCRIPT_LIMITS.MIN_TIMEOUT_SEC) fail('timeout_sec', `timeout_sec 必须 >= ${SCRIPT_LIMITS.MIN_TIMEOUT_SEC}`, 'timeout_too_small');
  if (raw > SCRIPT_LIMITS.MAX_TIMEOUT_SEC) {
    fail('timeout_sec', `timeout_sec 不得超过 ${SCRIPT_LIMITS.MAX_TIMEOUT_SEC} 秒`, 'timeout_too_large');
  }
  return raw;
}

function checkArtifacts(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail('artifact_paths', 'artifact_paths 必须是数组', 'artifacts_not_array');
  if (raw.length > SCRIPT_LIMITS.MAX_ARTIFACTS) {
    fail('artifact_paths', `artifact_paths 条数过多（${raw.length}，超过上限 ${SCRIPT_LIMITS.MAX_ARTIFACTS}）`, 'artifacts_too_many');
  }
  raw.forEach((p, i) => {
    if (typeof p !== 'string' || p === '') fail('artifact_paths', `artifact_paths[${i}] 必须是非空字符串`, 'artifact_invalid');
    if (CONTROL_ANY.test(p)) fail('artifact_paths', `artifact_paths[${i}] 含控制字符，拒绝`, 'artifact_control_chars');
    if (bytes(p) > SCRIPT_LIMITS.MAX_ARTIFACT_PATH_BYTES) fail('artifact_paths', `artifact_paths[${i}] 过长`, 'artifact_too_long');
  });
  return [...raw];
}

/**
 * 校验并规范化 script_run 的 payload。
 * @returns {{host:string, cmd:string, cwd:string|null, env:Object<string,string>, timeout_sec:number, artifact_paths:string[]}}
 *          host 已解析为 machine-registry 的机器 id。
 * @throws {ScriptPayloadError}
 */
export function validateScriptPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('payload', 'payload 必须是对象 {host, cmd, timeout_sec, ...}', 'payload_not_object');
  }
  return {
    host: checkHost(payload.host),
    cmd: checkCmd(payload.cmd),
    cwd: checkCwd(payload.cwd),
    env: checkEnv(payload.env),
    timeout_sec: checkTimeout(payload.timeout_sec),
    artifact_paths: checkArtifacts(payload.artifact_paths),
  };
}

/** 建单入口用：只有 script_run 才校验，其它类型直通。 */
export function assertScriptPayloadForType(taskType, payload) {
  if (taskType !== SCRIPT_TASK_TYPE) return null;
  return validateScriptPayload(payload);
}
