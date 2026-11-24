import {createHash} from 'node:crypto';
import { runDockerProcess } from './process.mjs';
import { stat, statfs } from 'node:fs/promises';
import { deployHealth, fail, IMAGE, US_MACHINE_ID } from './policy.mjs';
export function createDockerAdapter({ root, dataPath = '/run/cecelia-docker-data', expected, executable = 'docker', now = Date.now, timeoutMs = 30000 }) {
  if (expected?.machine_registry_id !== US_MACHINE_ID || !expected.daemon_id || !expected.docker_root_dir?.startsWith('/')
      || !Number.isSafeInteger(expected.volume_dev)) throw fail('HOST_IDENTITY_UNKNOWN');
  const run = (args, lease) => runDockerProcess(executable, args, lease, timeoutMs);
  const ids = (text, pattern) => {
    const values = [...new Set(text.trim().split(/\s+/).filter(Boolean))];
    if (values.length > 1000 || values.some(id => !pattern.test(id))) throw fail('DOCKER_ID_LIST_INVALID');
    return values;
  };
  async function identity(lease) {
    const info = JSON.parse(await run(['info', '--format', '{{json .}}'], lease));
    const volume = await stat(root), dataVolume = await stat(dataPath);
    if (info.OSType !== 'linux' || info.ID !== expected.daemon_id || info.DockerRootDir !== expected.docker_root_dir
        || volume.dev !== expected.volume_dev || dataVolume.dev !== expected.volume_dev) throw fail('DAEMON_IDENTITY_CHANGED');
  }
  async function snapshot(lease) {
    await identity(lease); const disk = await statfs(dataPath);
    const imageIds = ids(await run(['image', 'ls', '--all', '--no-trunc', '--quiet'], lease), IMAGE);
    const containerIds = ids(await run(['container', 'ls', '--all', '--quiet', '--no-trunc'], lease), /^[a-f0-9]{64}$/);
    const images = imageIds.length ? JSON.parse(await run(['image', 'inspect', ...imageIds], lease)) : [];
    const containers = containerIds.length ? JSON.parse(await run(['container', 'inspect', ...containerIds], lease)) : [];
    if (!Array.isArray(images) || !Array.isArray(containers) || images.length !== imageIds.length || containers.length !== containerIds.length
        || new Set(images.map(x => x.Id)).size !== imageIds.length || new Set(containers.map(x => x.Id)).size !== containerIds.length
        || images.some(x => !imageIds.includes(x.Id)) || containers.some(x => !containerIds.includes(x.Id))) throw fail('DOCKER_SNAPSHOT_INCOMPLETE');
    return { ...expected, observed_at: new Date(now()).toISOString(), disk: { total_bytes: disk.blocks * disk.bsize, available_bytes: disk.bavail * disk.bsize },
      images: images.map(x => ({ id: x.Id, tags: x.RepoTags, digests: x.RepoDigests, created_at: x.Created,
        git_sha: (x.Config?.Env ?? []).filter(value => value.startsWith('GIT_SHA=')).length === 1
          ? x.Config.Env.find(value => value.startsWith('GIT_SHA=')).slice(8) : null })),
      containers: containers.map(x => ({ id: x.Id, image_id: x.Image, name: x.Name, running: x.State?.Running })) };
  }
  // 状态读取只证明固定生产实例及收据镜像；janitor仍使用完整库存snapshot。
  async function deploymentSnapshot(imageId, lease) {
    if (!IMAGE.test(imageId)) throw fail('INVALID_IMAGE');
    await identity(lease);
    const values = JSON.parse(await run(['inspect', 'cecelia-node-brain', imageId], lease));
    if (!Array.isArray(values) || values.length !== 2) throw fail('DOCKER_SNAPSHOT_INCOMPLETE');
    const [container, image] = values;
    if (!/^[a-f0-9]{64}$/.test(container?.Id ?? '') || container.Name !== '/cecelia-node-brain'
        || container.Image !== imageId || container.State?.Running !== true || image?.Id !== imageId)
      throw fail('DEPLOY_CURRENT_MISMATCH');
    const env = image.Config?.Env;
    if (!Array.isArray(env) || env.some(value => typeof value !== 'string') || env.filter(value => value.startsWith('GIT_SHA=')).length !== 1)
      throw fail('CURRENT_IMAGE_UNKNOWN');
    return { images: [{ id: image.Id, tags: image.RepoTags, git_sha: env.find(value => value.startsWith('GIT_SHA=')).slice(8) }],
      containers: [{ id: container.Id, name: container.Name, image_id: container.Image, running: container.State.Running }] };
  }
  async function containerHealth(id, lease) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw fail('INVALID_CONTAINER_ID');
    const output = await run(['exec', id, 'curl', '-q', '-fsm', '10', '--max-filesize', '262144', '-w', '\n%{http_code}', 'http://127.0.0.1:5221/api/brain/health'], lease);
    const boundary = output.lastIndexOf('\n'), body = output.slice(0, boundary);
    if (boundary < 0 || !/^2[0-9]{2}$/.test(output.slice(boundary + 1).trim()) || Buffer.byteLength(body) > 262144) throw fail('DEPLOY_HEALTH_UNAVAILABLE');
    return deployHealth(JSON.parse(body));
  }
  async function containerBusinessReadback(id, lease) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw fail('INVALID_CONTAINER_ID');
    let output;
    try { output=await run(['exec',id,'curl','-q','-fsm','10','--max-filesize','262144','-w','\\n%{http_code}','http://127.0.0.1:5221/api/brain/tasks?limit=1'],lease); }
    catch { throw fail('DEPLOY_BUSINESS_UNAVAILABLE'); }
    const boundary=output.lastIndexOf('\n'),body=output.slice(0,boundary);let rows;
    if(boundary<0||output.slice(boundary+1).trim()!=='200'||Buffer.byteLength(body)>262144)throw fail('DEPLOY_BUSINESS_UNAVAILABLE');
    try{rows=JSON.parse(body);}catch{throw fail('DEPLOY_BUSINESS_UNAVAILABLE');}
    if(!Array.isArray(rows)||rows.length>1||rows.some(t=>!t||typeof t!=='object'||Array.isArray(t)
      ||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(t.id??'')||typeof t.title!=='string'||typeof t.status!=='string'))throw fail('DEPLOY_BUSINESS_UNAVAILABLE');
    return {protocol:'brain-release-readback/v1',status:'passed',container_id:id,task_count:rows.length,
      task_sample_sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),scope:'read_only',external_services:'not_evaluated'};
  }
  async function absent(id, lease) {
    if (!IMAGE.test(id)) throw fail('INVALID_IMAGE');
    await identity(lease);
    try {
      const values = JSON.parse(await run(['image', 'inspect', id], lease));
      if (!Array.isArray(values) || values.length !== 1 || values[0].Id !== id) throw fail('DOCKER_INSPECT_UNCONFIRMED');
      return false;
    } catch (error) {
      if (error.code !== 'DOCKER_UNCONFIRMED' || error.exitCode !== 1
          || error.stderr?.trim() !== `Error response from daemon: No such image: ${id}`
          || error.stdout?.trim() !== '[]') throw fail('DOCKER_INSPECT_UNCONFIRMED');
      await identity(lease); return true;
    }
  }
  async function remove(id, lease) {
    if (!IMAGE.test(id)) throw fail('INVALID_IMAGE');
    await identity(lease);
    return run(['image', 'rm', id], lease);
  }
  return Object.freeze({ snapshot, deploymentSnapshot, remove, absent, containerHealth, containerBusinessReadback });
}
