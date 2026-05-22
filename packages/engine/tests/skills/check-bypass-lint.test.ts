import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

const LINT = resolve(__dirname, '../../../../scripts/check-bypass-not-committed.sh')

describe('check-bypass-not-committed.sh', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'bypasslint-'))
    execSync(`cd ${repo} && git init -q && git config user.email t@t && git config user.name t`)
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('非豁免文件含 BYPASS=1 → exit 1', () => {
    // 写一个普通脚本含违规字符串
    writeFileSync(join(repo, 'bad.sh'), 'export CECELIA_STOP_HOOK_BYPASS=1\n')
    execSync(`cd ${repo} && git add bad.sh && git commit -q -m x`)

    let code = 0
    try {
      execSync(`cd ${repo} && bash ${LINT}`, { encoding: 'utf8', stdio: 'pipe' })
    } catch (e: any) {
      code = e.status
    }
    expect(code).toBe(1)
  })

})
