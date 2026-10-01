/**
 * loadActiveMachines — 薄封装，从 system_registry (type=machine, status=active) 读机器，
 * 带短缓存（防高频路由把 DB 打爆）。resolveExecutor 单测时整张 deps 注入假实现，不碰这里。
 *
 * Spec: docs/superpowers/specs/2026-06-03-machine-executor-routing-design.md §单元2
 */

import pool from '../db.js';

import { legacyExecutorEntries } from '../execution-directory/legacy-executor.js';
import { directory } from '../execution-directory/directory.js';
export async function loadActiveMachines() {
  if(!directory.current())await directory.refresh({pool});
  return (directory.current()?.nodes??[]).filter(n=>n.machine_status==='active').map(n=>({
    name:n.name,status:n.machine_status,id:n.machine_registry_id,canonical_id:n.canonical_id,
    metadata:{...n.metadata,executors:legacyExecutorEntries().filter(e=>e.machineId===n.canonical_id).map(({machineId,...e})=>e)},
  }));
}
export function clearMachineCache(){return directory.refresh({pool}).catch(()=>null);}
