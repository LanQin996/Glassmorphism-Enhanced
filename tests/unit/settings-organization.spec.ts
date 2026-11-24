import { expect, test } from '@playwright/test'
import manifest from '../../komari-theme.json' with { type: 'json' }
import { manualRouteConfig, manualValues } from '../../src/utils/manualRouteSettings'
import { parseReturnRouteConfig, resolveOutboundRoutes, resolveReturnRoutes } from '../../src/utils/returnRoutes'
import { ENHANCED_SETTINGS_GROUPS, settingGroup, THEME_FIELDS } from '../../src/utils/themeSettings'

const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const AT = '2026-11-13T08:00:00.000Z'
const values = { unicom: '9929', telecom: 'CN2', mobile: 'CMI' }

test('native manifest and manager use one ordered category definition', () => {
  expect(manifest.configuration.data.filter(f => f.type === 'title').map(f => f.name)).toEqual(ENHANCED_SETTINGS_GROUPS.map(g => g.title))
  let group = 'home'
  for (const f of manifest.configuration.data) {
    if (f.type === 'title')
      group = ENHANCED_SETTINGS_GROUPS.find(g => g.title === f.name)!.id
    else if ('key' in f && f.key)
      expect(settingGroup(f.key)).toBe(group)
  }
  for (const key of ['returnRoutesVisible', 'returnRouteAutoEnabled', 'returnRouteCompanionEnabled', 'returnRouteTtlHours', 'returnRouteConfig', 'transitCarrierPingEnabled', 'transitCarrierPingRules'])
    expect(settingGroup(key)).toBe('routes')
  expect(THEME_FIELDS.filter(f => settingGroup(f.key) === 'appearance').every(f => /^(?:themeMode|glass|colorVision|disablePageAnimation|background|lightBackground|darkBackground)/.test(f.key))).toBe(true)
})
test('theme-only manual edit preserves other UUIDs and unchanged timestamps, with no plugin fields', () => {
  const raw = JSON.stringify({ version: 1, nodes: { [A]: { manual: { telecom: { label: 'CN2', updatedAt: AT } }, auto: {} }, [B]: { manual: { mobile: { label: 'KEEP', updatedAt: null } }, auto: {} } } })
  const out = JSON.parse(manualRouteConfig(raw, A, values, '2026-11-13T10:00:00.000Z'))
  expect(out.nodes[B]).toEqual(JSON.parse(raw).nodes[B])
  expect(out.nodes[A].manual.telecom.updatedAt).toBe(AT)
  expect(Object.keys(out).sort()).toEqual(['nodes', 'version'])
  expect(raw).not.toContain('9929')
})
test('empty field removes only that carrier and never creates automatic evidence', () => {
  const first = manualRouteConfig('', A, values, AT)
  const out = parseReturnRouteConfig(manualRouteConfig(first, A, { ...values, unicom: '' }, AT))
  expect(out.document.nodes[A]!.manual.unicom).toBeUndefined()
  expect(manualValues(out.document.nodes[A])).toEqual({ ...values, unicom: '' })
  expect(out.document.nodes[A]!.auto).toEqual({})
})
test('manual routes round trip by family and direction with no cross-family fallback', () => {
  const first = manualRouteConfig('', A, values, AT)
  const later = '2026-11-13T10:00:00.000Z'
  const outbound = { telecom: '163', unicom: '', mobile: 'CMIN2' }
  const ipv6 = { manual: { telecom: 'V6-RETURN', unicom: '', mobile: '' }, outbound: { telecom: '', unicom: 'V6-OUT', mobile: '' } }
  const result = manualRouteConfig(first, A, { ipv4: { manual: values, outbound }, ipv6 }, later)
  const parsed = parseReturnRouteConfig(result)
  expect(parsed.error).toBeNull()
  expect(manualValues(parsed.document.nodes[A], 'outbound')).toEqual(outbound)
  expect(manualValues(parsed.document.nodes[A], 'manual', 'ipv6')).toEqual(ipv6.manual)
  expect(resolveOutboundRoutes(parsed.document, A).map(route => [route.carrier, route.label, route.at])).toEqual([
    ['telecom', '163', later],
    ['mobile', 'CMIN2', later],
  ])
  expect(resolveOutboundRoutes(parsed.document, A, 'ipv6').map(route => [route.carrier, route.label])).toEqual([['unicom', 'V6-OUT']])
  const v6 = resolveReturnRoutes(parsed.document, A, true, 24, Date.parse(later), 'ipv6')
  expect(v6.map(route => [route.carrier, route.label])).toEqual([['telecom', 'V6-RETURN'], ['unicom', '未检测'], ['mobile', '未检测']])
  expect(parsed.document.nodes[A]!.manual.telecom).toEqual({ label: 'CN2', updatedAt: AT })
  expect(parseReturnRouteConfig(manualRouteConfig(result, A, values, later)).document.nodes[A])
    .toEqual(parsed.document.nodes[A])
  expect(() => manualRouteConfig(first, A, { ipv6: { ...ipv6, outbound: { ...outbound, telecom: 'bad\u0000label' } } }, later)).toThrow()
})
test('legacy version zero remains readable and migrates through the existing serializer', () => {
  const raw = JSON.stringify({ version: 0, nodes: { [B]: { manual: { telecom: 'KEEP_LEGACY' } } } })
  const out = parseReturnRouteConfig(manualRouteConfig(raw, A, values, AT))
  expect(out.error).toBeNull()
  expect(out.document.nodes[B]!.manual.telecom!.label).toBe('KEEP_LEGACY')
})
for (const row of [{ uuid: 'node-name', text: 'safe' }, { uuid: A, text: 'x'.repeat(81) }, { uuid: A, text: 'bad\u0000label' }]) {
  test(`refuse malformed manual edit ${row.uuid} ${row.text.length}`, () => {
    expect(() => manualRouteConfig('', row.uuid, { ...values, telecom: row.text })).toThrow()
  })
}
test('corrupt prior JSON refuses instead of overwriting existing data', () => {
  expect(() => manualRouteConfig('{broken', A, values)).toThrow('未覆盖')
})
test('manual edits retain document, node and carrier extensions', () => {
  const raw = JSON.stringify({ version: 1, future: { keep: true }, nodes: { [A]: { futureNode: 'KEEP', manual: { telecom: { label: 'OLD', updatedAt: AT, futureCarrier: 42 } }, auto: {} }, [B]: { manual: {}, auto: {}, futureNode: 'OTHER' } } })
  const out = JSON.parse(manualRouteConfig(raw, A, values, AT))
  expect(out.future).toEqual({ keep: true })
  expect(out.nodes[A].futureNode).toBe('KEEP')
  expect(out.nodes[A].manual.telecom.futureCarrier).toBe(42)
  expect(out.nodes[B]).toEqual(JSON.parse(raw).nodes[B])
})
