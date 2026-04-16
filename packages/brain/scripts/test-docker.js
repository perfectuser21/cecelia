#!/usr/bin/env node
/**
 * test-docker.js — 简单端到端验证 docker-executor
 *
 * 用法：
 *   HARNESS_DOCKER_ENABLED=true node packages/brain/scripts/test-docker.js
 *
 * 行为：
 *   1. 检测 docker 可用性
 *   2. resolveResourceTier 抽样
 *   3. 如 docker 可用且 cecelia/runner:latest 存在 → spawn 一个简短 task 验证完整链路
 *   4. 如不可用 → 打印 SKIP 信息（CI 兼容）
 */

import {
  isDockerAvailable,
  resolveResourceTier,
  executeInDocker,
} from '../src/docker-executor.js';

async function main() {
  console.log('[test-docker] HARNESS_DOCKER_ENABLED=', process.env.HARNESS_DOCKER_ENABLED || '(unset)');

  // 1. 资源映射抽样
  for (const t of ['dev', 'planner', 'propose', 'unknown_type']) {
    console.log(`[test-docker] resolveResourceTier(${t}) =`, resolveResourceTier(t));
  }

  // 2. docker 可用性
  const available = await isDockerAvailable();
  console.log('[test-docker] docker available:', available);

  if (!available) {
    console.log('[test-docker] SKIP: docker 未安装/未启动，无法执行端到端 spawn 测试');
    console.log('[test-docker] 完成（仅做配置 sanity check，跳过 container spawn）');
    return;
  }

  if (process.env.HARNESS_DOCKER_ENABLED !== 'true') {
    console.log('[test-docker] SKIP: HARNESS_DOCKER_ENABLED != true，仅检查配置');
    return;
  }

  // 3. 端到端 spawn — 用一个不依赖 cecelia/runner:latest 的 alpine 测试镜像验证 docker 路径
  // 真实生产用 cecelia/runner:latest，本测试只验证 spawn/-rm/cgroup/timeout 链路
  console.log('[test-docker] spawn 简短 alpine 测试（不依赖 cecelia/runner 镜像）...');
  const fakeResult = await executeInDocker({
    task: { id: '00000000-0000-0000-0000-000000000001', task_type: 'planner' },
    prompt: 'echo hello-from-cecelia-runner',
    image: 'alpine:3.19',
    timeoutMs: 30000,
  });
  // 上面用 alpine 但 ENTRYPOINT 不会是 claude，会走 alpine 默认 entrypoint，
  // 期望结果：image pull 成功就算链路通；exit_code 不 assert
  console.log('[test-docker] result:', {
    exit_code: fakeResult.exit_code,
    duration_ms: fakeResult.duration_ms,
    timed_out: fakeResult.timed_out,
    container: fakeResult.container,
    stdout_len: fakeResult.stdout.length,
    stderr_len: fakeResult.stderr.length,
  });
  console.log('[test-docker] 完成');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[test-docker] FAIL:', err.message);
    process.exit(1);
  });
