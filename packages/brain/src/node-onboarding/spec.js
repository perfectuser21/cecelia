import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { resolvePrimaryWorkerId } from '../machine-registry.js';
import {withLinuxExecution} from './execution-view.js';

export const STAGES = [
  ['connect', '验证连接与身份'], ['probe', '检测系统'], ['install', '安装节点组件'],
  ['verify', '健康验收'], ['register', '登记设备'],
];
export const TERMINAL = new Set(['completed', 'completed_no_pr', 'failed', 'cancelled']);
const FIELDS = ['name', 'address', 'ssh_user', 'ssh_port', 'credential_ref', 'host_key_fingerprint', 'role', 'region'];
const hasControl = value => [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function enrollmentError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function validateEnrollment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw enrollmentError('接入信息必须是对象');
  if (Object.keys(input).some(k => !FIELDS.includes(k))) throw enrollmentError('仅接受接入表单字段，不能提交密钥或执行命令');
  const value = { ...input, ssh_port: input.ssh_port ?? 22 };
  for (const key of FIELDS.filter(k => k !== 'ssh_port')) {
    if (typeof value[key] !== 'string' || value[key].length > 300 || hasControl(value[key])) {
      throw enrollmentError(`接入字段 ${key} 无效`);
    }
    value[key] = value[key].trim();
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(value.name)) throw enrollmentError('机器名称须为 2–63 位小写字母、数字或连字符');
  value.address = value.address.toLowerCase();
  const ip = isIP(value.address);
  if (!ip && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value.address)) throw enrollmentError('机器地址无效');
  if (/^(localhost(?:\.|$)|127\.|0\.|169\.254\.|::1$|::$|fe80:|::ffff:)/i.test(value.address)) {
    throw enrollmentError('不能接入回环、未指定或链路本地地址');
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(value.ssh_user)) throw enrollmentError('SSH 用户名无效');
  if (!Number.isInteger(value.ssh_port) || value.ssh_port < 1 || value.ssh_port > 65535) throw enrollmentError('SSH 端口须为 1–65535 的整数');
  if (!/^op:\/\/CS\/[^/]+\/[^/]+$/.test(value.credential_ref)) throw enrollmentError('请选择 CS Vault 的 1Password 私钥引用');
  if (!/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(value.host_key_fingerprint)) throw enrollmentError('需要经过核对的 SHA256 主机指纹');
  if (!['observer', 'worker', 'service', 'database'].includes(value.role)) throw enrollmentError('节点用途无效');
  if (!['US', 'HK', 'CN', 'other'].includes(value.region)) throw enrollmentError('地区无效');
  return Object.fromEntries(FIELDS.map(k => [k, value[k]]));
}

export const requestHash = input => createHash('sha256').update(JSON.stringify(validateEnrollment(input))).digest('hex');

export function buildOnboardingScript(id, input, mode = 'enroll', config = {}) {
  if (!ID.test(id) || !['enroll', 'sample'].includes(mode)) throw enrollmentError('接入标识无效');
  const request = validateEnrollment(input);
  const runnerPath = config.runnerPath || process.env.CECELIA_ONBOARDING_RUNNER_PATH
    || '/Users/administrator/perfect21/cecelia-deploy-main/scripts/ops/node-onboarding.mjs';
  if (!runnerPath.startsWith('/') || hasControl(runnerPath)) throw enrollmentError('接入执行器路径未配置', 503);
  const quoted = `'${runnerPath.replaceAll("'", "'\\''")}'`;
  return {
    host: config.host || resolvePrimaryWorkerId(), cmd: `node ${quoted}`, timeout_sec: 240,
    env: { TASK_ONBOARDING_REQUEST: Buffer.from(JSON.stringify({ ...request, id, mode })).toString('base64') },
  };
}

export function readReceipt(task) {
  const stdout = task.result?.script?.stdout;
  if (typeof stdout !== 'string') return null;
  for (const line of stdout.split('\n').reverse()) {
    try {
      const value = JSON.parse(line);
      if (value?.type === 'node_onboarding_receipt') return value;
    } catch { /* 非结构化运行日志不作为验收证据。 */ }
  }
  return null;
}

export function validateReceipt(task, at = new Date()) {
  const meta = task.payload?.node_onboarding;
  const r = readReceipt(task);
  const fail = () => { throw enrollmentError('未取得有效的节点健康验收回执', 422); };
  if (!meta || !r || task.result?.script?.exit_code !== 0 || task.result?.script?.timed_out
      || r.verified !== true || r.id !== meta.id || r.name !== meta.request.name
      || r.mode !== meta.mode || !r.service?.enabled || !r.service?.active) fail();
  const h = r.health;
  const age = new Date(at).getTime() - new Date(h?.observed_at).getTime();
  if (h?.schema_version !== 1 || h.node_id !== meta.id || h.agent_version !== '1'
      || !Number.isInteger(h.sequence) || h.sequence < 2 || !['linux', 'darwin'].includes(h.os)
      || typeof h.hostname !== 'string' || !h.hostname || h.hostname.length > 255
      || !Number.isFinite(age) || age < -30_000 || age > 90_000
      || !ID.test(h.boot_id || '') || h.capabilities?.collector !== true || h.capabilities?.janitor !== true
      || h.capabilities?.execution !== false || h.janitor?.mode !== 'observe' || h.janitor?.policy !== 'owned-cache-only') fail();
  const v = h.resources;
  for (const k of ['memory_total_bytes', 'memory_available_bytes', 'cpu_load_1m', 'cpu_cores', 'disk_free_bytes', 'disk_total_bytes']) {
    if (!Number.isFinite(v?.[k]) || v[k] < 0) fail();
  }
  if (!Number.isInteger(v.cpu_cores) || v.cpu_cores < 1 || v.memory_total_bytes <= 0 || v.disk_total_bytes <= 0
      || v.memory_available_bytes > v.memory_total_bytes || v.disk_free_bytes > v.disk_total_bytes) fail();
  return r;
}

export function onboardingView(task, now = new Date(), execution) {
  const meta = task.payload.node_onboarding;
  let status = task.status;
  let report;
  let error = null;
  if (['completed', 'completed_no_pr'].includes(status)) {
    try { report = validateReceipt(task, task.completed_at || now); status = 'completed'; }
    catch { status = 'failed'; error = '安装脚本已结束，但节点身份、服务状态或连续采样未通过验收'; }
  } else if (status === 'failed') {
    error = '接入未完成，请核对连接、凭据引用、主机指纹及节点的服务管理环境后重试';
  } else if (status === 'cancelled') {
    error = '接入任务已取消';
  } else if (status !== 'in_progress') {
    status = 'queued';
  }
  if (meta.registration_error) { status = 'failed'; report = null; error = '设备名已被其他记录占用，不能覆盖已有台账'; }
  const failedReceipt = readReceipt(task);
  const trustedFailure = status === 'failed' && failedReceipt?.id === meta.id
    && failedReceipt?.name === meta.request.name && failedReceipt?.mode === meta.mode;
  const states = new Map(trustedFailure && Array.isArray(failedReceipt.steps)
    ? failedReceipt.steps.filter(s => STAGES.some(([k]) => k === s.key) && ['completed', 'failed'].includes(s.status)).map(s => [s.key, s.status]) : []);
  const errors = { HOST_KEY_MISMATCH: 'SSH 主机指纹与指定值不一致', CREDENTIAL_FAILED: '无法读取指定的 SSH 凭据',
    CONNECT_FAILED: '可信 SSH 连接或 Python3 环境不可用', PROBE_FAILED: '节点系统探测失败',
    INSTALL_FAILED: '节点服务安装失败，请检查服务管理环境', VERIFY_FAILED: '服务状态或连续健康样本未通过验收',
    TIMEOUT: '节点接入超过执行时限', INVALID_REQUEST: '节点接入参数不合法' };
  if (trustedFailure && Object.hasOwn(errors, failedReceipt.error_code)) error = errors[failedReceipt.error_code];
  const view = {
    id: meta.id, task_id: task.id, machine_name: meta.request.name,
    status, stage: status === 'completed' ? 'register' : [...states].find(([, value]) => value === 'failed')?.[0] ?? null,
    error, capabilities: report?.health.capabilities ?? null,
    notice: status === 'completed' ? '节点监控已接入；清理默认为观察模式，执行任务能力需另行验收' : null,
    steps: STAGES.map(([key, label]) => ({ key, label,
      status: status === 'completed' ? 'completed' : states.get(key) || 'pending',
    })),
  };
  return status==='completed'&&meta.request.role==='worker'&&report?.health.os==='linux'?withLinuxExecution(view,execution):view;
}
