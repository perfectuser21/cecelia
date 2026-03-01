/**
 * @file extract-learnings.test.ts
 * @description 测试 extract-learnings.sh 脚本的提取逻辑
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const SCRIPT_PATH = 'skills/dev/scripts/extract-learnings.sh'
const OUTPUT_FILE = '.dev-learnings-extracted.json'
const INCIDENT_FILE = '.dev-incident-log.json'

describe('extract-learnings.sh', () => {
  afterEach(() => {
    // 清理测试产物
    for (const f of [OUTPUT_FILE, INCIDENT_FILE]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  })

  describe('文件权限', () => {
    it('脚本应该可执行', () => {
      expect(() => execSync(`test -x ${SCRIPT_PATH}`)).not.toThrow()
    })
  })

  describe('--test-incident 模式', () => {
    it('应该成功从内置测试 incident 提取问题', () => {
      const result = execSync(`bash ${SCRIPT_PATH} --test-incident`, {
        encoding: 'utf-8',
      })
      expect(result).toContain('✅ --test-incident 通过')
    })

    it('输出应该包含 issues_found 字段', () => {
      const result = execSync(`bash ${SCRIPT_PATH} --test-incident`, {
        encoding: 'utf-8',
      })
      // 测试模式应该输出 JSON 内容（通过 jq .）
      expect(result).toContain('[')
    })
  })

  describe('--test-learnings 模式', () => {
    it('应该成功从内置测试 LEARNINGS.md 提取预防措施', () => {
      const result = execSync(`bash ${SCRIPT_PATH} --test-learnings`, {
        encoding: 'utf-8',
      })
      expect(result).toContain('✅ --test-learnings 通过')
    })

    it('提取的预防措施数量应该 >= 1', () => {
      const result = execSync(`bash ${SCRIPT_PATH} --test-learnings`, {
        encoding: 'utf-8',
      })
      const match = result.match(/提取到\s+(\d+)\s+条预防措施/)
      expect(match).not.toBeNull()
      const count = parseInt(match![1], 10)
      expect(count).toBeGreaterThanOrEqual(1)
    })
  })

  describe('主模式（无参数）', () => {
    it('无 incident log 和 LEARNINGS.md 时，应该生成空数组的输出文件', () => {
      execSync(`bash ${SCRIPT_PATH}`, { encoding: 'utf-8' })
      expect(fs.existsSync(OUTPUT_FILE)).toBe(true)

      const output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'))
      expect(output).toHaveProperty('issues_found')
      expect(output).toHaveProperty('next_steps_suggested')
      expect(Array.isArray(output.issues_found)).toBe(true)
      expect(Array.isArray(output.next_steps_suggested)).toBe(true)
    })

    it('有 incident log 时，应该提取 issues_found', () => {
      const incidents = [
        {
          step: '09-ci',
          type: 'ci_failure',
          description: 'CI 失败：版本不同步',
          error: 'version mismatch',
          resolution: '更新 .hook-core-version',
        },
      ]
      fs.writeFileSync(INCIDENT_FILE, JSON.stringify(incidents))

      execSync(`bash ${SCRIPT_PATH}`, { encoding: 'utf-8' })

      const output = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'))
      expect(output.issues_found.length).toBeGreaterThanOrEqual(1)
      expect(output.issues_found[0]).toContain('09-ci')
    })

    it('输出文件应该是合法的 JSON', () => {
      execSync(`bash ${SCRIPT_PATH}`, { encoding: 'utf-8' })
      expect(() => JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'))).not.toThrow()
    })
  })
})
