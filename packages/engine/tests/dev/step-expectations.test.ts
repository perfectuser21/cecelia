/**
 * @file step-expectations.test.ts
 * @description 测试 step-expectations.json 文件
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'

const EXPECTATIONS_FILE = 'skills/dev/lib/step-expectations.json'

describe('step-expectations.json', () => {
  it('文件应该存在', () => {
    expect(fs.existsSync(EXPECTATIONS_FILE)).toBe(true)
  })

  it('应该是合法的 JSON', () => {
    const content = fs.readFileSync(EXPECTATIONS_FILE, 'utf-8')
    expect(() => JSON.parse(content)).not.toThrow()
  })

  it('应该包含所有 11 个步骤', () => {
    const expectations = JSON.parse(fs.readFileSync(EXPECTATIONS_FILE, 'utf-8'))

    const expectedSteps = [
      '01-prd',
      '02-detect',
      '03-branch',
      '04-dod',
      '05-code',
      '06-test',
      '07-quality',
      '08-pr',
      '09-ci',
      '10-learning',
      '11-cleanup',
    ]

    for (const step of expectedSteps) {
      expect(expectations[step]).toBeDefined()
    }
  })

  it('每个步骤应该包含必需字段', () => {
    const expectations = JSON.parse(fs.readFileSync(EXPECTATIONS_FILE, 'utf-8'))

    for (const [stepId, stepData] of Object.entries(expectations) as Array<[string, any]>) {
      expect(stepData.name).toBeDefined()
      expect(typeof stepData.name).toBe('string')

      expect(stepData.quality_expectations).toBeDefined()
      expect(typeof stepData.quality_expectations).toBe('object')

      expect(stepData.common_pitfalls).toBeDefined()
      expect(Array.isArray(stepData.common_pitfalls)).toBe(true)

      expect(stepData.automation_level).toBeDefined()
      expect(['fully_automated', 'mostly_automated', 'semi_automated']).toContain(
        stepData.automation_level
      )
    }
  })

  it('quality_expectations 应该非空', () => {
    const expectations = JSON.parse(fs.readFileSync(EXPECTATIONS_FILE, 'utf-8'))

    for (const [stepId, stepData] of Object.entries(expectations) as Array<[string, any]>) {
      const qualityKeys = Object.keys(stepData.quality_expectations)
      expect(qualityKeys.length).toBeGreaterThan(0)
    }
  })

  it('common_pitfalls 应该有至少一个条目', () => {
    const expectations = JSON.parse(fs.readFileSync(EXPECTATIONS_FILE, 'utf-8'))

    for (const [stepId, stepData] of Object.entries(expectations) as Array<[string, any]>) {
      expect(stepData.common_pitfalls.length).toBeGreaterThan(0)
    }
  })
})
