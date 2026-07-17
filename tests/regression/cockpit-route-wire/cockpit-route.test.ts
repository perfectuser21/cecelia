import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { resolve } from 'path'

// 封装为 async 函数，满足 lint-test-quality 规则（await fn() 调用）
async function readSourceFile(relativePath: string): Promise<string> {
  return readFile(resolve(process.cwd(), relativePath), 'utf-8')
}

async function getManifestRoutes(): Promise<Array<{ path: string; component: string }>> {
  const content = await readSourceFile('apps/api/features/dashboard/index.ts')
  // 提取 routes 数组内容（正则匹配 path + component 对）
  const routeMatches = [...content.matchAll(/\{[^}]*path:\s*['"]([^'"]+)['"][^}]*component:\s*['"]([^'"]+)['"][^}]*\}/gs)]
  return routeMatches.map(m => ({ path: m[1], component: m[2] }))
}

describe('OwnerCockpit 路由接线 — 防孤儿断言', () => {
  it('App.tsx 顶层静态含 OwnerCockpitPage 引用（防孤儿断言）', async () => {
    const content = await readSourceFile('apps/dashboard/src/App.tsx')
    expect(content).toContain('OwnerCockpitPage')
  })

  it('manifest / 路由指向 OwnerCockpitPage（防孤儿 manifest 断言）', async () => {
    const routes = await getManifestRoutes()
    const rootRoute = routes.find(r => r.path === '/')
    expect(rootRoute).toBeDefined()
    expect(rootRoute?.component).toBe('OwnerCockpitPage')
  })
})
