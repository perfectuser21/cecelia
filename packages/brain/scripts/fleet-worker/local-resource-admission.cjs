'use strict';

const { execFile } = require('node:child_process');
const { readFileSync, lstatSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { lstat, stat } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
const GIB = 1024 ** 3;

function unavailable() {
  return Object.assign(new Error('attempt_local_resources_unavailable'), { statusCode: 429 });
}

function numeric(text) {
  const value = String(text ?? '').trim();
  return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
}

// Health reports must describe the filesystems that hold execution data. On
// macOS the sealed system volume can be almost empty while Data is full.
async function existingDiskDirectory(directory) {
  let candidate = directory;
  for (;;) {
    try { await lstat(candidate); }
    catch (error) {
      const parent = path.dirname(candidate);
      if (error.code !== 'ENOENT' || parent === candidate) throw error;
      candidate = parent;
      continue;
    }
    // A broken symlink or inaccessible directory must not be replaced by a
    // different filesystem just because its target cannot be inspected.
    if (!(await stat(candidate)).isDirectory()) throw unavailable();
    return candidate;
  }
}

async function probeDiskResources({ run, paths, allowMissingPaths = false }) {
  const unknown = { disk_free_bytes: 0, disk_used_percent: 100 };
  if (!Array.isArray(paths) || paths.length === 0
    || !paths.every((entry) => typeof entry === 'string' && path.isAbsolute(entry))) return unknown;
  try {
    const actualPaths = allowMissingPaths
      ? await Promise.all(paths.map(existingDiskDirectory)) : paths;
    const samples = await Promise.all([...new Set(actualPaths)].map(async (directory) => {
      const result = await run('df', ['-kP', directory]);
      if (result?.ok === false || (result?.code != null && result.code !== 0)) throw unavailable();
      const lines = String(result?.stdout ?? '').trim().split(/\r?\n/);
      const fields = lines.at(-1).trim().split(/\s+/);
      const free = numeric(fields[3]);
      const used = /^\d+(?:\.\d+)?%$/.test(fields[4] ?? '') ? numeric(fields[4].slice(0, -1)) : NaN;
      if (lines.length < 2 || !Number.isFinite(free) || !Number.isFinite(free * 1024)
        || !Number.isFinite(used) || used > 100) throw unavailable();
      return { disk_free_bytes: free * 1024, disk_used_percent: used };
    }));
    return {
      disk_free_bytes: Math.min(...samples.map((sample) => sample.disk_free_bytes)),
      disk_used_percent: Math.max(...samples.map((sample) => sample.disk_used_percent)),
    };
  } catch { return unknown; }
}

function validProfile(profile, workerId) {
  const limits = profile?.resources;
  return profile?.machine_id === workerId && limits
    && ['cpu_cores', 'memory_gib', 'disk_min_free_gib'].every((key) =>
      Number.isFinite(limits[key]) && limits[key] > 0)
    && ['disk_max_used_percent', 'cpu_pressure_max_percent', 'memory_pressure_max_percent']
      .every((key) => Number.isFinite(limits[key]) && limits[key] > 0 && limits[key] <= 100);
}

// Each call samples the target host afresh. This is a last-minute pressure
// check, not a reservation or a per-container resource limit.
function createLocalResourceAdmission({
  workerId,
  diskPaths,
  platform = process.platform,
  runCommand = runFile,
  now = Date.now,
  loadProfile = () => JSON.parse(readFileSync(path.join(__dirname, 'fleet-node-profiles.json'), 'utf8'))
    .profiles.find((profile) => profile.machine_id === workerId),
} = {}) {
  return async function assertLocalResources() {
    let timer;
    try {
      const profile = loadProfile();
      if (platform !== 'darwin' || !validProfile(profile, workerId)
        || !Array.isArray(diskPaths) || diskPaths.length === 0
        || !diskPaths.every((entry) => typeof entry === 'string' && path.isAbsolute(entry))) throw unavailable();
      const limits = profile.resources;
      const sampledAt = now();
      const commands = [
        ['sysctl', ['-n', 'hw.ncpu']], ['sysctl', ['-n', 'hw.memsize']],
        ['sysctl', ['-n', 'vm.loadavg']], ['memory_pressure', ['-Q']],
        ['docker', ['info', '--format', '{{json .}}']],
        ...[...new Set(diskPaths)].map((directory) => ['df', ['-kP', directory]]),
      ];
      const samples = await Promise.race([
        Promise.all(commands.map(async ([file, args]) => {
          const result = await runCommand(file, args, {
            shell: false, timeout: 4_000, maxBuffer: 64 * 1024, encoding: 'utf8',
          });
          if (result?.ok === false || (result?.code != null && result.code !== 0)) throw unavailable();
          return String(result?.stdout ?? '');
        })),
        new Promise((_, reject) => { timer = setTimeout(() => reject(unavailable()), 5_000); }),
      ]);
      if (!Number.isFinite(sampledAt) || now() - sampledAt >= 5_000 || now() < sampledAt) throw unavailable();
      const [cpuText, memoryText, loadText, pressureText, dockerText, ...disks] = samples;
      const cpus = numeric(cpuText);
      const memory = numeric(memoryText);
      const load = loadText.trim().match(/^\{\s*(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*\}$/);
      const free = pressureText.match(/System-wide memory free percentage:\s*(-?\d+(?:\.\d+)?)%/i);
      const memoryFreePercent = free ? Number(free[1]) : NaN;
      const docker = JSON.parse(dockerText);
      if (!Number.isInteger(cpus) || cpus < limits.cpu_cores
        || !Number.isFinite(memory) || memory < limits.memory_gib * GIB
        || !load || Number(load[1]) / cpus * 100 > limits.cpu_pressure_max_percent
        || !Number.isFinite(memoryFreePercent) || memoryFreePercent < 0 || memoryFreePercent > 100
        || 100 - memoryFreePercent > limits.memory_pressure_max_percent
        || !Number.isInteger(docker?.NCPU) || docker.NCPU <= 0
        || !Number.isFinite(docker?.MemTotal) || docker.MemTotal <= 0) throw unavailable();
      for (const diskText of disks) {
        const lines = diskText.trim().split(/\r?\n/);
        const fields = lines.at(-1).trim().split(/\s+/);
        const available = numeric(fields[3]);
        const used = /^\d+(?:\.\d+)?%$/.test(fields[4] ?? '') ? numeric(fields[4].slice(0, -1)) : NaN;
        if (lines.length < 2 || !Number.isFinite(available) || available * 1024 < limits.disk_min_free_gib * GIB
          || !Number.isFinite(used) || used > limits.disk_max_used_percent) throw unavailable();
      }
    } catch {
      // Command output can contain credentials or paths; return only a stable code.
      throw unavailable();
    } finally { clearTimeout(timer); }
  };
}

function guardLaunchCommand(runCommand,assertCanLaunch) {
  return async(...callArgs)=>{
    const [command,args]=callArgs;
    if(path.basename(command)==='docker'&&(['create','start','run'].includes(args?.[0])||(args?.[0]==='network'&&args?.[1]==='create')))assertCanLaunch();
    return runCommand(...callArgs);
  };
}
function createLocalLaunchAdmission({markerPath='/var/run/cecelia/fleet-worker.drain',lstat=lstatSync}={}) {
  if(typeof markerPath!=='string'||!path.isAbsolute(markerPath))throw Error('worker_drain_marker_invalid');
  const bootId=randomUUID();let active=0,revision=0;
  const draining=()=>{try{lstat(markerPath);return true;}catch(error){return error.code!=='ENOENT';}};
  const assertCanLaunch=()=>{if(draining())throw Object.assign(Error('worker_draining'),{statusCode:429});};
  return Object.freeze({assertCanLaunch,
    snapshot:()=>({boot_id:bootId,draining:draining(),in_flight_launches:active,activity_revision:revision}),
    track:async operation=>{active++;revision++;try{return await operation();}finally{active--;revision++; }},
    guardCommand:runCommand=>guardLaunchCommand(runCommand,assertCanLaunch),
  });
}
function wrapLaunchRunner(runner,admission) {
  return Object.freeze(Object.fromEntries(Object.entries(runner).map(([key,value])=>[key,
    ['prepare','start','attach'].includes(key)&&typeof value==='function'?(...args)=>admission.track(()=>value.apply(runner,args)):value])));
}
module.exports = { createLocalResourceAdmission, probeDiskResources, createLocalLaunchAdmission, wrapLaunchRunner, guardLaunchCommand };
