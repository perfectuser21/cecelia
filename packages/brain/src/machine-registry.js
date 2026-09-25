/**
 * machine-registry.js — 机器清单与角色模型（单一事实来源）
 *
 * 决策 2e756506（orchestrator 远程化方案B）+ a9773a84（DB 通路）。
 * 背景：主理人 2026-09-13 定调机器演进——10 月 Mac Studio(2TB/128GB) 到货后
 * 成为主力 worker，MMV 退位。此前 8 处 'us-mac-m4' 字面量的真实语义是
 * 「主力机兼凭据权威」，不是某台具体机器；迁移时会一次性爆发。
 * 本模块把角色提为一等公民：迁移 = 把 machineRole:'primary' 挪到新机器，代码零改动。
 *
 * 铁律：叶子模块，零依赖；判断逻辑禁止出现机器 id 字面量——一律角色解析。
 * 角色语义（引擎-机器绑定铁律 ca6bf8e7）：
 *   scheduler — 只调度不执行（us-vps，内存小）
 *   primary   — 主力 worker：跑 orchestrator + 全 provider；兼凭据权威
 *   secondary — 次级 worker：只跑 Codex
 */

export const MACHINE_ROLES = Object.freeze({
  SCHEDULER: 'scheduler',
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
});

// 完整机器清单：从 routes/infra-status.js SERVERS 原样迁入（Task 2 会把
// infra-status.js 改为从本模块 re-export），每个条目新增 machineRole 字段：
//   us-mac-m4   → 'primary'
//   us-vps      → 'scheduler'
//   hk-vps      → null
//   xian-mac-m1 → 'secondary'
//   xian-mac-m4 → 'secondary'
//   xian-pc     → null
//   nas         → null
export const MACHINES = Object.freeze([
  {
    id: 'us-mac-m4',
    name: '美国 Mac mini M4',
    location: '威斯康星',
    tailscaleIp: '100.71.151.105',
    publicIp: '38.23.47.81',
    role: '主力研发机',
    isLocal: true,
    sshUser: 'administrator',
    machineRole: MACHINE_ROLES.PRIMARY,
    aliases: ['mmv'],
  },
  {
    id: 'us-vps',
    name: '美国 VPS',
    location: '加州',
    tailscaleIp: '100.79.41.61',
    publicIp: '134.199.234.147',
    role: '公网中转 exit node',
    sshUser: 'root',
    machineRole: MACHINE_ROLES.SCHEDULER,
  },
  {
    id: 'hk-vps',
    name: '香港 VPS',
    location: '香港',
    tailscaleIp: '100.86.118.99',
    publicIp: '124.156.138.116',
    role: 'CI runner + 公网',
    sshUser: 'root',
    machineRole: null,
  },
  {
    id: 'xian-mac-m1',
    name: '西安 Mac mini M1',
    location: '西安',
    tailscaleIp: '100.88.166.55',
    role: 'L4 E2E CI 测试',
    sshUser: 'xx-macmini',
    machineRole: MACHINE_ROLES.SECONDARY,
    aliases: ['xian-m1'],
  },
  {
    id: 'xian-mac-m4',
    name: '西安 Mac mini M4',
    location: '西安',
    tailscaleIp: '100.86.57.69',
    role: 'Codex 主力机',
    sshUser: 'jinnuoshengyuan',
    machineRole: MACHINE_ROLES.SECONDARY,
    aliases: ['xian-m4'],
  },
  {
    id: 'xian-pc',
    name: '西安 PC (Windows)',
    location: '西安',
    tailscaleIp: '100.97.242.124',
    role: 'Playwright 被控端',
    sshUser: 'xuxia',
    isWindows: true,
    machineRole: null,
  },
  {
    id: 'nas',
    name: 'NAS',
    location: '西安',
    tailscaleIp: '100.110.241.76',
    role: '存储',
    sshUser: '徐啸',
    machineRole: null,
  },
]);

const primaries = MACHINES.filter((m) => m.machineRole === MACHINE_ROLES.PRIMARY);
if (primaries.length !== 1) {
  // fail-fast：0 台没有执行主力、>1 台凭据权威二义，都是部署级配置错误
  throw new Error(`machine_registry_primary_invalid:count=${primaries.length}`);
}

export function resolvePrimaryWorkerId() {
  return primaries[0].id;
}

export function isPrimaryWorker(machineId) {
  return machineId != null && machineId === primaries[0].id;
}

/**
 * 机器名 → 注册表 id：id 与 aliases 均按小写精确匹配（口头/运维别名如 mmv、xian-m4）。
 * 未知/空/非字符串返回 null——调用方自行决定拒绝口径（script 执行体据此做 host 白名单）。
 */
export function resolveMachineId(name) {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const hit = MACHINES.find((m) => m.id === key || (m.aliases ?? []).includes(key));
  return hit ? hit.id : null;
}

/** 机器 id → 角色（scheduler/primary/secondary/null）；未知机器返回 undefined。 */
export function machineRoleOf(machineId) {
  return MACHINES.find((m) => m.id === machineId)?.machineRole;
}

export function listComputeWorkerIds() {
  return MACHINES
    .filter((m) => m.machineRole === MACHINE_ROLES.PRIMARY
      || m.machineRole === MACHINE_ROLES.SECONDARY)
    .map((m) => m.id);
}

/** worker 桥地址：FLEET_WORKER_<ID大写下划线>_URL env 覆盖优先，否则 tailscaleIp:5231 */
export function workerBridgeUrlFor(machineId, env = process.env) {
  const machine = MACHINES.find((m) => m.id === machineId);
  if (!machine) return null;
  const envKey = `FLEET_WORKER_${machineId.toUpperCase().replaceAll('-', '_')}_URL`;
  if (env[envKey]) return env[envKey];
  if (!machine.tailscaleIp) return null;
  return `http://${machine.tailscaleIp}:5231`;
}

/**
 * ssh 直派目标解析：机器 id → 'user@tailscaleIp'。
 * 排单直驾通道（dispatch.channel='ssh'）用它把「在哪台机干」翻成可执行地址；
 * 缺 sshUser/tailscaleIp 的机器不可直派，显式抛错而非静默拼坏地址。
 */
export function sshTargetFor(machineId) {
  const m = MACHINES.find((x) => x.id === machineId);
  if (!m) throw new Error(`ssh_target_unknown_machine:${String(machineId)}`);
  if (!m.sshUser || !m.tailscaleIp) throw new Error(`ssh_target_not_dispatchable:${machineId}`);
  return `${m.sshUser}@${m.tailscaleIp}`;
}
