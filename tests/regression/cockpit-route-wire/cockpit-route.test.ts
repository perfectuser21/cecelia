import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

// 从测试文件自身定位 repo root——process.cwd() 会随跑测的 package 变化
// （brain-unit 的 cwd=packages/brain，用 cwd 解析必炸；#4038 合入时 brain-unit 未触发所以没暴露）
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// 封装为 async 函数，满足 lint-test-quality 规则（await fn() 调用）
async function readSourceFile(relativePath: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, relativePath), 'utf-8')
}

async function getManifestRoutes(relativePath: string): Promise<Array<{ path: string; component?: string; redirect?: string }>> {
  const content = await readSourceFile(relativePath)
  const routeMatches = [...content.matchAll(/\{[^}]*path:\s*['"]([^'"]+)['"][^}]*\}/gs)]
  return routeMatches.map(match => {
    const component = match[0].match(/component:\s*['"]([^'"]+)['"]/)?.[1]
    const redirect = match[0].match(/redirect:\s*['"]([^'"]+)['"]/)?.[1]
    return { path: match[1], component, redirect }
  })
}

describe('OwnerCockpit 路由接线 — 防孤儿断言', () => {
  it('App.tsx 顶层静态含 OwnerCockpitPage 引用（防孤儿断言）', async () => {
    const content = await readSourceFile('apps/dashboard/src/App.tsx')
    expect(content).toContain('OwnerCockpitPage')
  })

  it('根路由统一进入 Workbench Overview，且 Overview 挂载 OwnerCockpit（防孤儿 manifest 断言）', async () => {
    const routes = await getManifestRoutes('apps/api/features/dashboard/index.ts')
    const rootRoute = routes.find(r => r.path === '/')
    expect(rootRoute).toBeDefined()
    expect(rootRoute?.redirect).toBe('/workbench/overview')

    const workbenchRoutes = await getManifestRoutes('apps/api/features/workbench/index.ts')
    const overviewRoute = workbenchRoutes.find(r => r.path === '/workbench/overview' && r.component)
    expect(overviewRoute).toBeDefined()
    expect(overviewRoute?.component).toBe('WorkbenchOverview')

    const workbenchManifest = await readSourceFile('apps/api/features/workbench/index.ts')
    expect(workbenchManifest).toContain("WorkbenchOverview: () => import('../../../dashboard/src/pages/owner-cockpit/OwnerCockpitPage')")
  })
})
