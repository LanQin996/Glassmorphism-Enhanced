import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { installKomariFixture } from './fixtures/komari'

const require = createRequire(import.meta.url)
const { PREVIEW_SCENARIOS, auditSummary } = require('./fixtures/final-route.cjs')

const UUID = '00000000-0000-4000-8000-000000000001'
const AT = '2026-07-25T11:00:00Z'
const ORDER = ['telecom', 'unicom', 'mobile']
interface SummaryAudit {
  carriers: string[]
  labels: Array<{ text: string, clippedCharacters: number }>
  horizontalOverflow: boolean
}
for (const width of [1440, 320]) {
  for (const size of ['mini', 'compact'] as const) {
    for (const dark of [false, true]) {
      for (const [scenario, labels] of Object.entries(PREVIEW_SCENARIOS) as Array<[string, Record<string, string>]>) {
        test(`equal direction columns ${scenario}/${width}/${size}/${dark ? 'dark' : 'light'}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 1000 })
          const manual = Object.fromEntries(Object.entries(labels).map(([carrier, label]) => [carrier, { label, updatedAt: AT }]))
          const outbound = { telecom: { label: '163', updatedAt: AT } }
          await installKomariFixture(page, { hideEarth: true, dark, nodeCardSize: size, themeSettings: { returnRoutesVisible: true, returnRouteConfig: JSON.stringify({ version: 1, nodes: { [UUID]: { manual, outbound } } }) } })
          await page.goto('/')
          const card = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情', exact: true })
          const line = card.locator('[data-route-summary]')
          await expect(line).toBeVisible()
          await page.evaluate(() => document.fonts.ready)
          const full = await line.evaluate(auditSummary) as SummaryAudit
          expect(full.carriers).toEqual(ORDER)
          expect(full.labels.map(label => label.text)).toEqual(['163', ...ORDER.map(carrier => labels[carrier])])
          expect(full.horizontalOverflow).toBe(false)
          expect(full.labels.every(label => label.clippedCharacters === 0)).toBe(true)
          for (const carrier of ORDER) {
            const cells = await line.locator(`[data-route-row="${carrier}"] [role="cell"]`).evaluateAll(els => els.map((el) => {
              const { x, width } = el.getBoundingClientRect()
              return { x, width }
            }))
            expect(cells).toHaveLength(2)
            expect(Math.abs(cells[0]!.width - cells[1]!.width)).toBeLessThanOrEqual(0.1)
            expect(cells[0]!.x + cells[0]!.width).toBeLessThan(cells[1]!.x)
            await expect(card.locator(`[data-carrier-ping="${carrier}-latency"]`)).toBeVisible()
            await expect(card.locator(`[data-carrier-ping="${carrier}-loss"]`)).toBeVisible()
          }
        })
      }
    }
  }
}
for (const carrier of ['telecom', 'mobile']) {
  test(`partial ${carrier} stays in its carrier row and return column`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 })
    const manual = { [carrier]: { label: 'CTGNET', updatedAt: AT } }
    await installKomariFixture(page, { hideEarth: true, themeSettings: { returnRoutesVisible: true, returnRouteConfig: JSON.stringify({ version: 1, nodes: { [UUID]: { manual } } }) } })
    await page.goto('/')
    const line = page.locator(`[data-route-node="${UUID}"] [data-route-summary]`)
    await expect(line.locator('[data-return-carrier]')).toHaveCount(1)
    const cells = line.locator(`[data-route-row="${carrier}"] [role="cell"]`)
    await expect(cells).toHaveText(['—', 'CTGNET'])
    await expect(cells.nth(1)).toHaveAttribute('data-return-carrier', carrier)
  })
}
