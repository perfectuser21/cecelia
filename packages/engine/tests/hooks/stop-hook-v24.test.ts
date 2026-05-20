// packages/engine/tests/hooks/stop-hook-v24.test.ts
//
// TDD 失败测试 — v24 修复尚未实现时，这些测试必须全部失败。
//
// v24 修复目标：
//   1. session_id 从 env var CLAUDE_HOOK_SESSION_ID 读取（不再依赖 stdin pipe）
//   2. 找到对应灯后，调用 classify_session(cwd) 判断真实业务状态
//   3. classify=blocked  → block，reason 必须含 action 文本
//   4. classify=done     → 清理灯文件 + kill guardian，exit 0
//   5. classify=not-dev  → exit 0 放行
//   6. session_id 空     → exit 0 放行（无 env var = 非受控模式）
//
// v23.1.0 Bug（导致 T13-T16 失败的根本原因）：
//   - hook_session_id 只从 stdin pipe 读，CLAUDE_HOOK_SESSION_ID 根本不被读取
//   - classify_session 函数从未被调用（v23 只看 lights mtime）
//   - T16 中空 session_id + 非 pipe 模式走 tty_no_session_id → release，看起来对
//     但实际路径错误（tty_no_session_id vs 我们想要的 no_env_session_id）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, utimesSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const HOOK = resolve(__dirname, '../../hooks/stop-dev.sh')

// ============================================================================
// v24 接口：session_id 通过 env var 传入，不 pipe stdin
// spawnSync 捕获 stderr（release 时诊断信息写 stderr，不写 stdout）
// ============================================================================
function runHookV24(
  testRepo: string,
  sessionId: string,
  extraEnv: Record<string, string> = {}
): { stdout: string; stderr: string; code: number } {
  const envObj: Record<string, string> = { ...(process.env as Record<string, string>), CLAUDE_HOOK_CWD: testRepo }
  if (sessionId !== '') {
    envObj.CLAUDE_HOOK_SESSION_ID = sessionId
  }
  for (const [k, v] of Object.entries(extraEnv)) {
    envObj[k] = v
  }

  const result = spawnSync('bash', [HOOK], {
    env: envObj,
    cwd: testRepo,
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.status ?? 0,
  }
}

// v23 兼容接口（通过 stdin pipe 传 session_id）
function runHookV23Style(
  testRepo: string,
  sessionId: string
): { stdout: string; stderr: string; code: number } {
  const payload = JSON.stringify({ session_id: sessionId })
  try {
    const out = execSync(
      `cd '${testRepo}' && CLAUDE_HOOK_CWD='${testRepo}' echo '${payload.replace(/'/g, "'\\''")}' | bash '${HOOK}'`,
      { encoding: 'utf8', timeout: 10000 }
    )
    return { stdout: out, stderr: '', code: 0 }
  } catch (e: any) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', code: e.status ?? 1 }
  }
}

// ============================================================================
// 构造 lights 文件（.cecelia/lights/<sidShort>-<branch>.live）
// ============================================================================
function makeLight(
  lightsDir: string,
  sidShort: string,
  branch: string,
  guardianPid = 99999,
  ageSeconds = 0
): string {
  mkdirSync(lightsDir, { recursive: true })
  const f = join(lightsDir, `${sidShort}-${branch}.live`)
  writeFileSync(
    f,
    JSON.stringify({
      session_id: `${sidShort}-full-uuid`,
      branch,
      worktree_path: `/tmp/wt-${branch}`,
      started_at: new Date().toISOString(),
      host: 'test-host',
      guardian_pid: guardianPid,
    })
  )
  if (ageSeconds > 0) {
    const t = (Date.now() - ageSeconds * 1000) / 1000
    utimesSync(f, t, t)
  }
  return f
}

// ============================================================================
// mock devloop-check.sh：放在 testRepo/packages/engine/lib/devloop-check.sh
//
// stop-dev.sh 优先 source $main_repo/packages/engine/lib/devloop-check.sh
// 其中 main_repo = git worktree list 第一行（testRepo 本身是 git root → main_repo=testRepo）
// 所以 mock 文件放 testRepo/packages/engine/lib/ 即可被正确 source。
// ============================================================================
function mockClassifySession(testRepo: string, resultJson: string) {
  const libDir = join(testRepo, 'packages/engine/lib')
  mkdirSync(libDir, { recursive: true })

  // 用单引号安全写入 resultJson（内部已转义单引号）
  const safeJson = resultJson.replace(/'/g, "'\\''")

  writeFileSync(
    join(libDir, 'devloop-check.sh'),
    `#!/usr/bin/env bash
# Mock devloop-check.sh for v24 TDD tests
classify_session() {
  echo '${safeJson}'
  return 0
}
log_hook_decision() { :; }
`,
    { mode: 0o755 }
  )
}

// ============================================================================
// 测试套件
// ============================================================================
describe('stop-dev.sh v24 新场景（T13-T16）', () => {
  let testRepo: string
  let lightsDir: string

  beforeEach(() => {
    testRepo = mkdtempSync(join(tmpdir(), 'hookv24-'))
    // 初始化真实 git repo（让 main_repo 探测成功）
    execSync(
      `cd '${testRepo}' && git init -q && git -c user.email=t@t.com -c user.name=t commit --allow-empty -m init -q`
    )
    lightsDir = join(testRepo, '.cecelia/lights')
  })

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true })
  })

  // --------------------------------------------------------------------------
  // T13: 灯亮 + classify=blocked + action 有值 → block，reason 包含 action 文本
  //
  // v24 期望行为：
  //   找到 session 的灯 → 调用 classify_session(testRepo) → 返回 blocked + action
  //   → 输出 {"decision":"block","reason":"..."} 且 reason 含 action 文本
  //
  // v23 实际行为（为何失败）：
  //   v23 不读 CLAUDE_HOOK_SESSION_ID env var → hook_session_id 为空
  //   非 pipe 模式下走 tty_no_session_id → release（不 block）
  //   且 classify_session 从未被调用
  // --------------------------------------------------------------------------
  it('T13: 灯亮 + classify=blocked + action 有值 → block reason 包含 action 文本', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    mockClassifySession(
      testRepo,
      JSON.stringify({
        status: 'blocked',
        reason: 'CI 失败（failure）',
        action: 'gh run view 12345 --log-failed',
      })
    )

    const r = runHookV24(testRepo, 'abc12345-full-uuid')

    // v24 要求：必须 block
    expect(r.stdout).toMatch(/"decision"\s*:\s*"block"/)
    // v24 要求：reason 含 action 文本
    expect(r.stdout).toMatch(/gh run view 12345/)
    // v24 要求：reason 含原始 reason 文本
    expect(r.stdout).toMatch(/CI 失败/)
  })

  // --------------------------------------------------------------------------
  // T14: 灯亮 + classify=done → guardian 被 kill，灯文件被删，exit 0
  //
  // v24 期望行为：
  //   找到灯 → classify_session=done → hook 清理：kill guardian_pid + 删灯文件 → exit 0
  //
  // v23 实际行为（为何失败）：
  //   同 T13：不读 env var → release，但不清理灯文件/不 kill guardian
  //   （就算碰巧 exit 0，灯文件仍在 → 测试 existsSync 失败）
  // --------------------------------------------------------------------------
  it('T14: 灯亮 + classify=done → guardian 被 kill，灯文件被删，exit 0', () => {
    // 启动真实子进程作为 guardian，用 node 代替 sleep（避免 shell sleep 被拦截）
    const { spawnSync, spawn } = require('child_process') as typeof import('child_process')
    const guardianProc = spawn(process.execPath, ['-e', 'setInterval(()=>{},60000)'], {
      detached: true,
      stdio: 'ignore',
    })
    guardianProc.unref()
    const guardianPid = guardianProc.pid!

    // 确认 guardian 在运行
    expect(() => process.kill(guardianPid, 0)).not.toThrow()

    const lightFile = makeLight(lightsDir, 'abc12345', 'cp-test', guardianPid)
    mockClassifySession(
      testRepo,
      JSON.stringify({ status: 'done', reason: 'cleanup_done' })
    )

    const r = runHookV24(testRepo, 'abc12345-full-uuid')

    // v24 要求：exit 0（不 block）
    expect(r.code).toBe(0)
    // v24 要求：不输出 block decision
    expect(r.stdout).not.toMatch(/"decision"\s*:\s*"block"/)
    // v24 要求：灯文件已被删除
    expect(existsSync(lightFile)).toBe(false)
    // v24 要求：guardian 进程已被 kill（SIGTERM 发出，进程 dead 或 zombie 均可）
    // 等待进程状态更新（spawnSync 阻塞事件循环，SIGCHLD pending，zombie 不被立即回收）
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},500)'], { timeout: 2000 })
    // 检查进程状态：不存在(ESRCH) 或 zombie(Z) 均视为已 killed
    // 在此容器环境 ps 不可用，改用 /proc/PID/status（Linux）或 ps（macOS）检测 zombie
    let guardianKilled = false
    try {
      process.kill(guardianPid, 0)
      // 进程仍在 process table（可能是 zombie）
      // Linux: 通过 /proc/PID/status 检测 zombie（ps 在容器内不可用）
      // macOS: 通过 ps -p PID -o stat= 检测 zombie
      if (process.platform === 'linux') {
        try {
          const { readFileSync } = require('fs') as typeof import('fs')
          const procStatus = readFileSync(`/proc/${guardianPid}/status`, 'utf8')
          guardianKilled = /^State:\s+Z/m.test(procStatus)
        } catch (_procErr) {
          guardianKilled = true  // /proc entry 消失 = 进程已彻底消失
        }
      } else {
        const psOut = execSync(`ps -p ${guardianPid} -o stat= 2>/dev/null || echo ''`, { encoding: 'utf8' }).trim()
        guardianKilled = psOut.includes('Z')
      }
    } catch (_e) {
      guardianKilled = true  // ESRCH = 进程已彻底消失
    }
    expect(guardianKilled).toBe(true)
  })

  // --------------------------------------------------------------------------
  // T15: 灯亮 + classify=not-dev → exit 0 放行
  //
  // v24 期望行为：
  //   通过 env var 读取 session_id → 找到灯 → classify_session=not-dev → exit 0 放行
  //   stdout 中应含 classify_session 返回的 reason（"主分支放行"）证明确实调用了它
  //
  // v23 实际行为（为何失败）：
  //   v23 不读 CLAUDE_HOOK_SESSION_ID → hook_session_id 空 → tty_no_session_id → release
  //   classify_session 从未被调用 → stdout 中不会含 "主分支放行"
  //   → expect(r.stdout).toMatch(/主分支放行/) 失败
  // --------------------------------------------------------------------------
  it('T15: 灯亮 + classify=not-dev → exit 0 + stderr 含 classify reason', () => {
    makeLight(lightsDir, 'abc12345', 'cp-test')
    mockClassifySession(
      testRepo,
      JSON.stringify({ status: 'not-dev', reason: '主分支放行' })
    )

    const r = runHookV24(testRepo, 'abc12345-full-uuid')

    // v24 要求：exit 0
    expect(r.code).toBe(0)
    // v24 要求：不 block（stdout 空 = Claude Code Stop hook 正常放行）
    expect(r.stdout).not.toMatch(/"decision"\s*:\s*"block"/)
    // v24 要求：stderr 含 classify_session 的 reason（证明 classify_session 被调用了）
    // release 时诊断写 stderr，不写 stdout（避免 Claude Code Stop hook JSON 验证失败）
    expect(r.stderr).toMatch(/主分支放行/)
  })

  // --------------------------------------------------------------------------
  // T16: session_id 空（无 env var）→ exit 0 放行
  //
  // v24 期望行为：
  //   CLAUDE_HOOK_SESSION_ID 未设置 → 视为非受控模式，直接 exit 0，不查灯，不调 classify
  //   stdout 含 reason_code "no_env_session_id"（v24 新增的早退 reason）
  //
  // v23 实际行为（为何失败）：
  //   v23 不认识 "no_env_session_id" 这个 reason_code
  //   → v23 走 tty_no_session_id 分支（或 no_session_id_pipe），reason_code 不匹配
  //   → expect(r.stdout).toMatch(/no_env_session_id/) 失败
  //
  // 注意：v24 需要在 hook stdout 输出新的 reason_code（通过 log_hook_decision 或 jq 块）
  // --------------------------------------------------------------------------
  it('T16: session_id 空（无 env var）→ exit 0，stderr 含 no_env_session_id reason', () => {
    // 即使有灯，空 session_id 也应该直接放行
    makeLight(lightsDir, 'abc12345', 'cp-test')
    mockClassifySession(
      testRepo,
      JSON.stringify({ status: 'blocked', reason: '这不应该被调用' })
    )

    // 不传 sessionId（空字符串 → runHookV24 不设 CLAUDE_HOOK_SESSION_ID）
    const r = runHookV24(testRepo, '')

    // v24 要求：exit 0
    expect(r.code).toBe(0)
    // v24 要求：不 block（stdout 空 = Claude Code Stop hook 正常放行）
    expect(r.stdout).not.toMatch(/"decision"\s*:\s*"block"/)
    // v24 要求：stderr 含 reason_code "no_env_session_id"（v24 专属，v23 没有这个）
    // release 时诊断写 stderr，不写 stdout（避免 Claude Code Stop hook JSON 验证失败）
    expect(r.stderr).toMatch(/no_env_session_id/)
    // v24 要求：classify_session 不应被调用
    expect(r.stdout + r.stderr).not.toMatch(/这不应该被调用/)
  })
})
