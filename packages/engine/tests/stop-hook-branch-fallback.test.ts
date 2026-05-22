import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const STOP_DEV = require('path').resolve(__dirname, '../hooks/stop-dev.sh')

describe('stop-dev.sh — Fix 3：branch 名兜底扫描', () => {
  let mainRepo: string
  let cwdRepo: string

  beforeEach(() => {
    // cwdRepo：模拟在 cp-* 分支的 worktree（stop hook 运行的 CLAUDE_HOOK_CWD）
    cwdRepo = mkdtempSync(join(tmpdir(), 'branchrepo-'))
    execSync(
      `cd ${cwdRepo} && git init -q && ` +
      `git -c user.email=t@t -c user.name=t commit --allow-empty -m init -q && ` +
      `git checkout -b cp-fix-test-branch -q`,
      { stdio: 'pipe' }
    )

    // mainRepo：worktree list 的 head-1（cwdRepo 自身作为 main repo）
    mainRepo = cwdRepo
  })

  afterEach(() => {
    rmSync(cwdRepo, { recursive: true, force: true })
  })

  it('session ID 前缀错位时，branch 兜底找到 light，stderr 不含 all_dark', () => {
    const branch = 'cp-fix-test-branch'
    const lightsDir = join(mainRepo, '.cecelia/lights')
    mkdirSync(lightsDir, { recursive: true })

    // 故意用错误前缀命名 light（模拟 executor 注入 Brain task UUID 的情况）
    const lightFile = join(lightsDir, `wrongsid0-${branch}.live`)
    writeFileSync(lightFile, JSON.stringify({
      branch,
      guardian_pid: 99999,
      session_id: 'wrongsid0-mock',
      session_id_short: 'wrongsid0',
      stage: 'stage_1_spec',
    }))

    // 用不匹配的真实 session ID（前8位 aabbccdd，与 wrongsid0 不同）
    const realSessionId = 'aabbccdd-1234-5678-90ab-cdef01234567'

    // 使用 spawnSync 确保无论 exit code 是什么都能捕获 stderr
    const { spawnSync } = require('child_process')
    const result = spawnSync('bash', [STOP_DEV], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_HOOK_SESSION_ID: realSessionId,
        CLAUDE_HOOK_CWD: cwdRepo,
        STOP_HOOK_LIGHT_TTL_SEC: '300',
      },
    })

    const stderr = result.stderr || ''

    // Fix 3 实现前：session 前缀不匹配 → LIGHTS_COUNT=0 → all_dark
    // Fix 3 实现后：branch 兜底找到 light → LIGHTS_COUNT=1 → classify_session → classify_not_dev
    // 本测试此时应该 FAIL（因为还没实现 Fix 3，会看到 all_dark）
    expect(stderr).not.toContain('"reason_code":"all_dark"')
  })
})
