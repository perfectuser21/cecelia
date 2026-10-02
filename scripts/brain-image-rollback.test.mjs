import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStore } from './brain-image-retention/storage.mjs';
import { createDeploymentLedger } from './brain-image-retention/ledger.mjs';
const run = promisify(execFile), image = n => 'sha256:' + String(n).repeat(64), sha = n => String(n).repeat(40);
test('正式rollback从失败的新镜像恢复原完整ID后才解除原pending', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'image-rollback-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['state', 'scripts/lib', 'scripts/brain-image-retention', 'bin']) await mkdir(join(root, dir), { recursive: true, mode: 0o700 });
  for (const file of ['brain-rollback.sh', 'lib/brain-image-retention.sh']) await copyFile(new URL(file, import.meta.url), join(root, 'scripts', file));
  const statePath = join(root, 'current'); await writeFile(statePath, '1');
  const fixture = `import fs from 'node:fs';
import {createStore} from ${JSON.stringify(new URL('./brain-image-retention/storage.mjs', import.meta.url).href)};
import {createDeploymentLedger} from ${JSON.stringify(new URL('./brain-image-retention/ledger.mjs', import.meta.url).href)};
const image=n=>'sha256:'+String(n).repeat(64),sha=n=>String(n).repeat(40),current=()=>Number(fs.readFileSync(${JSON.stringify(statePath)},'utf8'));
export const store=createStore(${JSON.stringify(join(root, 'state'))});
export const ledger=createDeploymentLedger({store,docker:{snapshot:async()=>({containers:[{name:'/cecelia-node-brain',running:true,image_id:image(current())}],images:[1,2].map(n=>({id:image(n),tags:['cecelia-brain:1.0.'+n],git_sha:sha(n)}))})},health:async()=>({status:'healthy',version:'1.0.'+current(),git_sha:sha(current())})});`;
  await writeFile(join(root, 'fixture.mjs'), fixture);
  const { store, ledger } = await import(join(root, 'fixture.mjs'));
  const deployment_id = randomUUID(); await ledger.begin({ deployment_id, version: '1.0.2', git_sha: sha(2) });
  await writeFile(statePath, '2'); await assert.rejects(ledger.finish(deployment_id, 'recovered'), /DEPLOY_IMAGE_MISMATCH/);
  await writeFile(join(root, 'scripts/brain-image-retention/cli.mjs'), `import {ledger} from '../../fixture.mjs';
const [command,id,version,git_sha,image_id]=process.argv.slice(2);
try {if(command==='rollback') {const r=await ledger.rollback({deployment_id:id,version,git_sha,image_id});process.stdout.write([r.deployment_id,r.outcome,r.image_id].join(' '));}
else if(command==='begin'){await ledger.begin({deployment_id:id,version,git_sha});process.stdout.write(id);}
else process.stdout.write((await ledger.finish(id,version)).outcome);}catch(e){process.stderr.write(e.code||e.message);process.exitCode=1;}`);
  await writeFile(join(root, 'bin/docker'), `#!/bin/sh
printf '%s %s\\n' "$*" "\${CECELIA_ROLLBACK_IMAGE:-}" >> "$FIXTURE_DOCKER_LOG"
case "$*" in
 *'{{json .Config.Env}}'*) printf '%s' '["GIT_SHA=${sha(1)}"]';;
 *'{{.Id}}'*) printf '%s' '${image(1)}';;
 compose*) printf '1' > "$FIXTURE_CURRENT";;
esac
`, { mode: 0o700 });
  for (const file of ['curl', 'sleep']) await writeFile(join(root, 'bin', file), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const env = { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH, FIXTURE_DOCKER_LOG: join(root, 'calls'), FIXTURE_CURRENT: statePath };
  await run('bash', [join(root, 'scripts/brain-rollback.sh'), '1.0.1'], { env, timeout: 5000 });
  const calls = await readFile(join(root, 'calls'), 'utf8');
  assert.match(calls, new RegExp('compose.*' + image(1))); // 完整ID必须传入compose，不能仅信可移动tag。
  assert.equal((await store.read('ledger.json')).pending, null);
  assert.equal((await store.read(`deployment-${deployment_id}.json`)).receipt.outcome, 'recovered');
  assert.deepEqual((await store.read('ledger.json')).successes, []);
});
