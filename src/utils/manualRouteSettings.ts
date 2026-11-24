import type { PingAddressFamily } from '@/utils/carrierPing'
import type { ReturnCarrier } from '@/utils/returnRouteClassification'
import type { NodeReturnRoutes } from '@/utils/returnRoutes'
import { RETURN_CARRIERS } from '@/utils/returnRouteClassification'
import { parseReturnRouteConfig, serializeReturnRoutes } from '@/utils/returnRoutes'

const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
type CarrierLabels = Record<ReturnCarrier, string>
interface DirectionLabels { manual: CarrierLabels, outbound?: CarrierLabels }
export type RouteLabelDrafts = Partial<Record<PingAddressFamily, DirectionLabels>>

// Theme-only edit. Never touches Plugin configuration, dispatch or permissions.
export function manualRouteConfig(raw: unknown, uuid: string, values: CarrierLabels | RouteLabelDrafts, at = new Date().toISOString()): string {
  if (!UUID.test(uuid))
    throw new Error('请选择有效节点 UUID；未写入')
  const parsed = parseReturnRouteConfig(raw)
  if (parsed.error)
    throw new Error('原有线路 JSON 无效；未覆盖，请先在高级选项修复')
  // Validate with the shared parser, but do not use its normalized projection as
  // the storage document: it deliberately strips unrecognized extension fields.
  const original = raw == null || raw === '' ? {} : typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw))
  const document = { ...original, version: 1, nodes: { ...original.nodes } }
  if (parsed.migrated) {
    for (const [key, row] of Object.entries(parsed.document.nodes))
      document.nodes[key] = { ...document.nodes[key], ...row, ipv6: row.ipv6 ? { ...document.nodes[key].ipv6, ...row.ipv6 } : undefined, auto: document.nodes[key].auto ?? {} }
  }
  const drafts: RouteLabelDrafts = 'telecom' in values ? { ipv4: { manual: values } } : values
  const node = { ...document.nodes[uuid], manual: document.nodes[uuid]?.manual ?? {}, auto: document.nodes[uuid]?.auto ?? {} }
  for (const family of ['ipv4', 'ipv6'] as const) {
    const edits = drafts[family]
    if (!edits)
      continue
    const section = family === 'ipv4' ? node : { ...node.ipv6 }
    for (const direction of ['manual', 'outbound'] as const) {
      const labels = edits[direction]
      if (!labels)
        continue
      const routes = { ...section[direction] }
      for (const carrier of RETURN_CARRIERS) {
        const label = labels[carrier].trim()
        if (!label)
          delete routes[carrier]
        else if (label !== routes[carrier]?.label)
          routes[carrier] = { ...routes[carrier], label, updatedAt: at }
      }
      if (Object.keys(routes).length || (family === 'ipv4' && direction === 'manual'))
        section[direction] = routes
      else
        delete section[direction]
    }
    if (family === 'ipv6') {
      if (Object.keys(section).length)
        node.ipv6 = section
      else
        delete node.ipv6
    }
  }
  document.nodes[uuid] = node
  serializeReturnRoutes(document) // Apply the same bounds and validation; no partial writes.
  return JSON.stringify(document, null, 2)
}
export function manualValues(node: NodeReturnRoutes | undefined, direction: 'manual' | 'outbound' = 'manual', family: PingAddressFamily = 'ipv4'): CarrierLabels {
  const routes = (family === 'ipv6' ? node?.ipv6 : node)?.[direction]
  return { unicom: routes?.unicom?.label ?? '', telecom: routes?.telecom?.label ?? '', mobile: routes?.mobile?.label ?? '' }
}
