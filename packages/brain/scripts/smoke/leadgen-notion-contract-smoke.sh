#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { buildDirectoryRows } from './packages/brain/src/projection/directory-source.js';
import { buildDirectorySchemas } from './packages/brain/src/projection/directory-schema.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dbs = Object.fromEntries(['areas','value_streams','capabilities','workflows','activities','steps'].map((name,i) => [name,id(i+100)]));
assert.deepEqual(buildDirectorySchemas(dbs).workflows['还缺什么'],{rich_text:{}});
const workflow = {id:id(4),key:'leadgen_104',name:'获客104',capability_id:id(3),status:'paused',current_definition_version_id:id(40)};
workflow.definition_version = {id:id(40),workflow_id:workflow.id,payload:{workflow_id:workflow.id,contract:{known_gaps:[{gap:'发送硬探针未接入',task:'bdd9fb75'}]}}};
const data = {areas:[{id:id(1),name:'部门'}],journeys:[{id:id(2),name:'价值流',kind:'value_stream',area_id:id(1)},
  {id:id(3),name:'能力',kind:'capability',parent_journey_id:id(2)}],workflows:[workflow],activities:[],steps:[],refs:[],map_nodes:[]};
const row = buildDirectoryRows(data,{}).find(entry => entry.id === workflow.id);
assert.match(row.properties['还缺什么'].rich_text[0].text.content,/发送硬探针未接入/);
assert.equal(row.properties['启用状态'].select.name,'暂停');
console.log('leadgen Notion Workflow 合同缺口投影 smoke 通过');
NODE
