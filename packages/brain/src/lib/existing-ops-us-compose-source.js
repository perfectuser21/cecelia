/** US退役配置仅认完整受审组合；不执行候选源码，不读取凭据或生产机器。 */
import { createHash } from 'node:crypto';
const COMPOSE = 'docker-compose.us-vps.yml';
const hash = text => createHash('sha256').update(text).digest('hex');
const PATHS = {
  "guard": "packages/brain/src/openclaw-guards.js",
  "host": "packages/brain/src/host-exec.js",
  "notion": "packages/brain/src/notion-push-sync.js",
  "template": "packages/brain/src/lib/openclaw-dispatch-template.js",
  "defaults": "packages/brain/src/lib/openclaw-dispatch-defaults.js",
  "ledger": "packages/brain/src/feishu-task-ledger.js",
  "ingest": "packages/brain/src/openclaw-run-ingest.js"
};
const HASHES = {
  "guard": "9d6933a6d7ed61955c5ebd920357c5d08500e2a2e665d5bc3f08958cb0202063",
  "host": "11d58722a08d8b4c4d0fb9afa107c5840c3845302dcead62d4653a501c182daf",
  "notion": "22cbe332597cfe00cba9c5950d81b6ce267dbaa9e78f081403053713630a659c",
  "template": "0c964c2d5e81c1feeb7ed5ea72ef8a3e0272da48ee72e53174b11d3ae8a17fe4",
  "defaults": "0572c1c9dcd5e9b31ac49c2ea3355c0c0c2e0b7fdd30117c559b6bbeb97e3a7a",
  "ledger": "7c749eb053dc5eabe6160dcf5ec854857fc27eb215832823599079fd23ae29bc",
  "ingest": "f12d790cdb7e7cf61e97e0e1d85034fccf1a2ab1c73296b8e736dbff9a39e709"
};
// 四个阶段来自真实候选4d7ed2a5/f6cc5bc1f/e5b9437c4父树/e5b9437c4。
// final卸挂载额外要求远端ledger，不能仅靠compose哈希解锁。
const STAGES = {
  "7d152cec3fea0f50cab0a707bd7830a01c620953ffcc99851be27e384aca405b": [
    "guard",
    "host"
  ],
  "81621e0bac0ae54045b5c4d2973c15ca7e960c87cf4406028d03c45d3e9a8d5a": [
    "notion",
    "template",
    "defaults"
  ],
  "ed11f478e6ca21f997fb26c0fc4e7baddfd5a17a36789aa3e5da17a56f26d617": [
    "guard",
    "host",
    "notion",
    "template",
    "defaults"
  ],
  "ef7b77ce25f3d91e8be933fd604bbbd3dd0457fab6a5c1bd1a72f8d6fb10baf2": [
    "guard",
    "host",
    "notion",
    "template",
    "defaults",
    "ledger",
    "ingest"
  ]
};
const EDGES = [
 ['guard','host'], ['notion','template'], ['template','defaults'],
 ['ledger','host'], ['ledger','ingest'], ['ingest','host'],
];
export async function proveReviewedUsCompose({ text, read, relations, revision }) {
 if (typeof text !== 'string') return false;
 const selected = STAGES[hash(text)];
 if (!selected) return false;
 // read()记录同一次返回的真实字节；必须全体通过才追加关系。
 for (const name of selected) {
  const bytes = await read(PATHS[name]);
  if (typeof bytes !== 'string' || hash(bytes) !== HASHES[name]) return false;
 }
 for (const name of ['guard','notion','ledger'].filter(n=>selected.includes(n)))
  relations.push({consumer_path:COMPOSE,input_path:PATHS[name],kind:'reviewed_us_openclaw_prerequisite',revision});
 for (const [from,to] of EDGES) if (selected.includes(from) && selected.includes(to))
  relations.push({consumer_path:PATHS[from],input_path:PATHS[to],kind:'reviewed_us_openclaw_static_import',revision});
 return true;
}
