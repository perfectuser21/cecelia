import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

/**
 * FD 201 leak regression test
 *
 * Bug 历史：worktree-manage.sh cmd_create 用 `exec 201>"$lock_file"` + flock 锁
 * worktree-create.lock。然后 fork dev-heartbeat-guardian.sh 后台。
 * fork 时 guardian 进程**继承 FD 201**，cmd_create 退出后父进程关 FD 201
 * 但 guardian 仍开着 → 锁仍持有 → 下次 cmd_create 失败"另一个进程正在创建"。
 *
 * 修复：guardian fork 时显式 `201>&-` 关闭该 FD。
 */
describe('worktree-manage.sh — FD 201 leak (cp-0507172354 PR-3)', () => {
  const SCRIPT = resolve(__dirname, '../../skills/dev/scripts/worktree-manage.sh')
  let mainRepo: string

  beforeEach(() => {
    mainRepo = mkdtempSync(join(tmpdir(), 'fd201-'))
    execSync(
      `cd ${mainRepo} && git init -q && git config user.email t@t && git config user.name t && git commit --allow-empty -m init -q && git branch -M main`,
      { stdio: 'pipe' }
    )
  })

  afterEach(() => {
    // 杀残留 guardian
    try {
      execSync(`pkill -f 'hb.sh.*${mainRepo}' 2>/dev/null || true`)
    } catch {}
    rmSync(mainRepo, { recursive: true, force: true })
  })

  it('cmd_create 退出后 worktree-create.lock 不再被 guardian 持有', () => {
    const env = {
      ...process.env,
      CLAUDE_SESSION_ID: 'fd201abc-test',
      GUARDIAN_INTERVAL_SEC: '1',
    }

    // 创建 worktree（fork guardian）
    execSync(`cd ${mainRepo} && bash ${SCRIPT} create test-fd201`, {
      encoding: 'utf8',
      env,
    })

    // 给 guardian 0.5s 启动稳定
    execSync('sleep 1')

    // 验证 worktree-create.lock 不再被任何进程持有
    // macOS lsof 是查 FD 的标准工具
    let lockHolders = ''
    try {
      lockHolders = execSync(
        `lsof "${mainRepo}/.git/worktree-create.lock" 2>/dev/null | tail -n +2 || true`,
        { encoding: 'utf8' }
      ).trim()
    } catch {
      lockHolders = ''
    }

    // 如果 guardian 漏关 FD 201，lockHolders 会含 bash + hb.sh
    // 期望：lockHolders 为空（FD 已被关闭）
    expect(lockHolders).toBe('')
  }, 10000)

  it('worktree-manage.sh fork guardian 行包含 201>&-（防回退 lint）', () => {
    const content = readFileSync(SCRIPT, 'utf8')
    // 找 nohup ... & fork 行（在 v23 PR-2 之后是通过 $_hb_link 启动 guardian）
    const nohupLines = content.split('\n').filter(l => /nohup\s+bash/.test(l))
    expect(nohupLines.length).toBeGreaterThan(0)
    expect(nohupLines.some(l => l.includes('201>&-'))).toBe(true)
  })
})
