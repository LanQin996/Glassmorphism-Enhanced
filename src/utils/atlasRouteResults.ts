import type { PingAddressFamily } from '@/utils/carrierPing'
import type { ReturnCarrier, ReturnHop } from '@/utils/returnRouteClassification'
import type { ReturnRouteDisplay } from '@/utils/returnRoutes'
import { classifyReturnRoute, RETURN_CARRIERS } from '@/utils/returnRouteClassification'
import { evidenceKeys } from '@/utils/routeProbeEvidence'

const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
type AtlasDirection = 'cn-to-node' | 'node-to-cn'
interface AtlasReading {
  family: 4 | 6
  direction: AtlasDirection
  carrier: ReturnCarrier
  collectedAt: string
  reachedTarget: boolean
  hops: ReturnHop[]
}
export interface AtlasRouteSnapshot {
  nodes: Record<string, AtlasReading[]>
  error?: 'invalid-bindings'
}

export function parseAtlasRouteSnapshot(raw: unknown): AtlasRouteSnapshot {
  evidenceKeys(raw, ['nodes', 'error'])
  const nodes = raw.nodes
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes) || Object.keys(nodes).length > 240)
    throw new TypeError('invalid Atlas snapshot')
  if (raw.error !== undefined && raw.error !== 'invalid-bindings')
    throw new TypeError('invalid Atlas error')
  const parsed: AtlasRouteSnapshot = { nodes: {}, ...(raw.error ? { error: raw.error } : {}) }
  for (const [uuid, readings] of Object.entries(nodes)) {
    if (!UUID.test(uuid) || !Array.isArray(readings) || readings.length > 12)
      throw new TypeError('invalid Atlas node')
    const slots = new Set<string>()
    parsed.nodes[uuid] = readings.map((reading: unknown) => {
      evidenceKeys(reading, ['family', 'direction', 'carrier', 'collectedAt', 'reachedTarget', 'hops'])
      const { family, direction, carrier, collectedAt, reachedTarget, hops } = reading
      if ((family !== 4 && family !== 6) || (direction !== 'cn-to-node' && direction !== 'node-to-cn') || typeof carrier !== 'string'
        || !RETURN_CARRIERS.includes(carrier as ReturnCarrier)
        || typeof collectedAt !== 'string' || !ISO_TIME.test(collectedAt) || !Number.isFinite(Date.parse(collectedAt)) || new Date(collectedAt).toISOString() !== collectedAt
        || typeof reachedTarget !== 'boolean' || !Array.isArray(hops) || hops.length > 64) {
        throw new TypeError('invalid Atlas reading')
      }
      const slot = `${family}:${direction}:${carrier}`
      if (slots.has(slot))
        throw new TypeError('duplicate Atlas slot')
      slots.add(slot)
      const seen = new Set<number>()
      const trace = hops.map((hop: unknown) => {
        evidenceKeys(hop, ['ttl', 'asns'])
        if (typeof hop.ttl !== 'number' || !Number.isInteger(hop.ttl) || hop.ttl < 1 || hop.ttl > 64 || seen.has(hop.ttl) || !Array.isArray(hop.asns) || hop.asns.length > 4
          || hop.asns.some(asn => !Number.isInteger(asn) || asn < 1 || asn > 4294967295)) {
          throw new TypeError('invalid Atlas hop')
        }
        seen.add(hop.ttl)
        return { ttl: hop.ttl, asns: hop.asns }
      })
      return { family, direction, carrier: carrier as ReturnCarrier, collectedAt, reachedTarget, hops: trace }
    })
  }
  return parsed
}

export function resolveAtlasRoutes(snapshot: AtlasRouteSnapshot | undefined, uuid: string, family: PingAddressFamily, direction: AtlasDirection, ttlHours: number, now: number): ReturnRouteDisplay[] {
  const addressFamily = family === 'ipv6' ? 6 : 4
  const ttl = Math.min(168, Math.max(1, Number.isFinite(ttlHours) ? ttlHours : 24)) * 3600000
  return (snapshot?.nodes[uuid] ?? []).filter(reading => reading.family === addressFamily && reading.direction === direction).map((reading) => {
    const age = now - Date.parse(reading.collectedAt)
    const classification = classifyReturnRoute(reading.carrier, reading.hops, reading.reachedTarget, { allowObservedWithGaps: true })
    const expired = age >= ttl
    const status = expired ? 'expired' : age < -300000 || classification.confidence === 'uncertain' ? 'unknown' : 'fresh-auto'
    return {
      carrier: reading.carrier,
      label: expired ? '已过期' : age < -300000 ? '未知' : classification.label,
      status,
      source: 'auto',
      provider: 'ripe-atlas',
      at: reading.collectedAt,
      detail: `RIPE Atlas / RIPEstat · IPv${addressFamily} · ${direction === 'cn-to-node' ? '国内 → 节点' : '节点 → 国内'} · ${classification.evidence}`,
    }
  })
}
