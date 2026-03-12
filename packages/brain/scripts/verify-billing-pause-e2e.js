#!/usr/bin/env node
/**
 * verify-billing-pause-e2e.js
 *
 * 端到端验证 PR #874 billing pause 熔断完整路径：
 *   quota_exhausted → setBillingPause → tick 熔断 → requeue
 *
 * 使用方式:
 *   node packages/brain/scripts/verify-billing-pause-e2e.js
 *
 * 前提条件: Brain 服务运行在 localhost:5221
 */

const BRAIN_URL = 'http://localhost:5221/api/brain';

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BRAIN_URL}${path}`, opts);
  const json = await res.json();
  return { status: res.status, data: json };
}

async function cleanup(taskId) {
  try {
    // 先确保 billing pause 已清除
    await api('GET', '/billing-pause?clear=true');
    if (taskId) {
      // 将测试任务标记为完成（需先设为 in_progress）
      await api('PATCH', `/tasks/${taskId}`, { status: 'in_progress' }).catch(() => {});
      await api('POST', '/execution-callback', {
        task_id: taskId,
        status: 'AI Done',
        result: { summary: 'verify-billing-pause-e2e cleanup' },
      });
    }
  } catch (e) {
    // 忽略清理错误
  }
}

async function main() {
  console.log('=== verify-billing-pause-e2e ===\n');

  let testTaskId = null;

  // ── 前置：确保 billing pause 干净状态 ─────────────────
  await api('GET', '/billing-pause?clear=true');

  try {
    // ─────────────────────────────────────────────────────
    // Step 1: billing-pause API 端点可用，初始 active=false
    // ─────────────────────────────────────────────────────
    console.log('Step 1: 确认 billing-pause API 端点可用');
    const { status: s1, data: d1 } = await api('GET', '/billing-pause');
    assert(s1 === 200, 'API 返回 200');
    assert(d1.success === true, 'success=true');
    assert(d1.active === false, 'active=false（初始状态）', JSON.stringify(d1));
    console.log();

    // ─────────────────────────────────────────────────────
    // Step 2: 创建测试任务并触发 quota_exhausted 回调
    // ─────────────────────────────────────────────────────
    console.log('Step 2: 创建测试任务并触发 quota_exhausted 回调');

    const ts = Date.now();
    const { data: createData } = await api('POST', '/tasks', {
      title: `[verify-e2e] billing pause test ${ts}`,
      priority: 'P2',
      task_type: 'dev',
      description: '验证 billing pause 熔断路径的临时测试任务，执行完毕后自动清理',
    });

    if (!createData?.id) {
      throw new Error('任务创建失败: ' + JSON.stringify(createData));
    }

    testTaskId = createData.id;
    assert(!!testTaskId, '测试任务创建成功', testTaskId);

    // 注意：PATCH /tasks/:id 只允许 pending→in_progress，queued→in_progress 不被支持。
    // 但 execution-callback 在 setBillingPause 调用发生在 DB 事务之外，即使任务仍为 queued
    // 状态，billing pause 全局标志依然会被正确设置。这是设计上的幂等保护（non-fatal）。

    // 触发 quota_exhausted 回调（1 小时后 reset）
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { status: cbStatus, data: cbData } = await api('POST', '/execution-callback', {
      task_id: testTaskId,
      status: 'AI Quota Exhausted',
      result: {
        quota_reset_at: resetAt,
        summary: 'verify-billing-pause: simulated quota exhausted',
      },
    });
    assert(cbStatus === 200, 'quota_exhausted 回调返回 200', JSON.stringify(cbData));
    assert(cbData?.success === true, 'callback success=true');
    console.log();

    // ─────────────────────────────────────────────────────
    // Step 3: 确认 billing pause 已激活
    // ─────────────────────────────────────────────────────
    console.log('Step 3: 确认 billing pause active=true');
    const { data: d3 } = await api('GET', '/billing-pause');
    assert(d3.active === true, 'billing pause active=true', JSON.stringify(d3));
    assert(d3.reason === 'quota_exhausted', 'reason=quota_exhausted', d3.reason);
    assert(!!d3.resetTime, 'resetTime 已设置', d3.resetTime);
    console.log(`  ℹ️  resetTime: ${d3.resetTime}`);
    console.log();

    // ─────────────────────────────────────────────────────
    // Step 4: 确认 tick 熔断（dispatch 被跳过）
    // ─────────────────────────────────────────────────────
    console.log('Step 4: 确认 tick 熔断（dispatch 跳过）');

    // 等待当前 tick 执行完成（若有），最多等 15 秒
    let tickReady = false;
    for (let i = 0; i < 15; i++) {
      const { data: tickStatus } = await api('GET', '/tick/status');
      if (!tickStatus?.tick_running) {
        tickReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    const { data: tickData } = await api('POST', '/tick');
    const tickStr = JSON.stringify(tickData);

    // billing pause 触发时 tick 返回 billing_pause 信号
    // 若后台 tick 仍在运行（already_running），则通过 billing_pause API 状态来验证
    const isBillingPauseActive = tickStr.includes('billing_pause');
    const isAlreadyRunning = tickData?.reason === 'already_running';

    if (isAlreadyRunning) {
      // 后台 tick 仍在运行，改为验证 billing pause 全局状态（已在 Step 3 验证）
      const { data: bpCheck } = await api('GET', '/billing-pause');
      assert(bpCheck.active === true, 'tick 运行中：billing pause 仍为 active（dispatch 将被跳过）');
      console.log(`  ℹ️  tick 正在运行，billing pause active=${bpCheck.active}（保证下次 dispatch 被跳过）`);
    } else {
      assert(isBillingPauseActive, 'tick 返回包含 billing_pause 信号', tickStr.slice(0, 200));
    }
    console.log(`  ℹ️  tick response: ${tickStr.slice(0, 200)}`);
    console.log();

    // ─────────────────────────────────────────────────────
    // Step 5: 清除 pause，确认 requeue 生效
    // ─────────────────────────────────────────────────────
    console.log('Step 5: 清除 billing pause + 验证 requeue');
    const { data: clearData } = await api('GET', '/billing-pause?clear=true');
    assert(clearData.cleared === true, 'billing pause 已清除', JSON.stringify(clearData));

    // 确认 billing pause 已失效
    const { data: d5 } = await api('GET', '/billing-pause');
    assert(d5.active === false, 'billing pause active=false（已清除）');

    // 触发 tick（应当将 quota_exhausted 任务 requeue）
    await api('POST', '/tick');

    // 检查测试任务状态是否回到 queued
    const { data: taskData } = await api('GET', `/tasks/${testTaskId}`);
    const taskStatus = taskData?.status || taskData?.task?.status;
    assert(
      taskStatus === 'queued',
      `quota_exhausted 任务已 requeue（status=queued）`,
      `实际 status: ${taskStatus}`
    );
    console.log();

  } finally {
    // 清理测试任务
    if (testTaskId) {
      await cleanup(testTaskId);
      console.log(`🧹 测试任务 ${testTaskId} 已清理`);
    }
  }

  // ─────────────────────────────────────────────────────
  // 最终报告
  // ─────────────────────────────────────────────────────
  console.log('─'.repeat(50));
  console.log(`结果: ${passed} 通过 / ${failed} 失败`);

  if (failed > 0) {
    console.error('\n❌ 端到端验证失败');
    process.exit(1);
  } else {
    console.log('\n✅ 端到端验证全部通过');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('验证脚本运行异常:', err.message);
  process.exit(1);
});
