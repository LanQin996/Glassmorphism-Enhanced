import type { MaybeRefOrGetter } from 'vue'
import type { PingAddressFamily } from '@/utils/carrierPing'
import type { ProtocolPaths } from '@/utils/routeProbeSnapshot'
import { computed, onScopeDispose, toValue, watch } from 'vue'
import { probeConnection, probeSnapshot, subscribeRouteProbe } from '@/services/routeProbe.service'
import { useAppStore } from '@/stores/app'
import { resolveAtlasRoutes } from '@/utils/atlasRouteResults'
import { resolveOutboundRoutes, resolveReturnRoutes } from '@/utils/returnRoutes'
import { protocolRouteDisplay, withProbeResults } from '@/utils/routeProbeSnapshot'

export function useNodeReturnRoutes(uuid: MaybeRefOrGetter<string>, family: MaybeRefOrGetter<PingAddressFamily> = 'ipv4') {
  const app = useAppStore()
  let release: (() => void) | undefined
  const isIPv4 = computed(() => toValue(family) === 'ipv4')
  const connected = computed(() => app.returnRouteCompanionEnabled && app.returnRouteAutoEnabled && app.returnRoutesVisible && app.privateFeaturesAllowed)
  watch(connected, (enabled) => {
    release?.()
    release = enabled ? subscribeRouteProbe() : undefined
  }, { immediate: true })
  onScopeDispose(() => release?.())
  const atlas = computed(() => connected.value ? probeSnapshot.value.atlas : undefined)
  const hasAtlasNode = computed(() => Object.hasOwn(atlas.value?.nodes ?? {}, toValue(uuid)))
  const hasAtlasIPv6 = computed(() => Boolean(atlas.value?.nodes[toValue(uuid)]?.some(reading => reading.family === 6)))
  const atlasReturns = computed(() => resolveAtlasRoutes(atlas.value, toValue(uuid), toValue(family), 'node-to-cn', app.returnRouteTtlHours, app.returnRouteNow))
  const atlasOutbound = computed(() => resolveAtlasRoutes(atlas.value, toValue(uuid), toValue(family), 'cn-to-node', app.returnRouteTtlHours, app.returnRouteNow))
  const document = computed(() => {
    const uuidValue = toValue(uuid)
    const config = app.returnRouteConfig.document
    const merged = connected.value && isIPv4.value ? withProbeResults(config, uuidValue, probeSnapshot.value) : config
    if (!hasAtlasNode.value)
      return merged
    const auto = merged.nodes[uuidValue]?.auto ?? {}
    return { version: 1 as const, nodes: { [uuidValue]: { manual: {}, auto } } }
  })
  const rawEvidence = computed(() => isIPv4.value && app.privateFeaturesAllowed ? document.value.nodes[toValue(uuid)]?.auto : undefined)
  const protocolEvidence = computed(() => {
    const node = probeSnapshot.value.nodes[toValue(uuid)]
    if (!connected.value || !isIPv4.value || !node?.enabled || !node.protocols)
      return undefined
    const paths: ProtocolPaths = {}
    for (const carrier of ['telecom', 'unicom', 'mobile'] as const) {
      const incoming = node.auto[carrier]
      const saved = app.returnRouteConfig.document.nodes[toValue(uuid)]?.auto[carrier]
      if (incoming && (!saved || Date.parse(incoming.collectedAt) >= Date.parse(saved.collectedAt)))
        paths[carrier] = node.protocols[carrier]
    }
    return paths
  })
  // Legacy inline auto data is not authorization to publish measurements.
  // Live automatic evidence comes only from the administrator-only snapshot.
  const entries = computed(() => resolveReturnRoutes(document.value, toValue(uuid), app.returnRouteAutoEnabled && app.privateFeaturesAllowed, app.returnRouteTtlHours, app.returnRouteNow, toValue(family)).map((entry) => {
    const measured = atlasReturns.value.find(row => row.carrier === entry.carrier)
    if (measured)
      return measured
    const paths = protocolEvidence.value?.[entry.carrier]
    return paths ? protocolRouteDisplay(toValue(uuid), entry, paths, app.returnRouteTtlHours, app.returnRouteNow) : entry
  }))
  const outboundEntries = computed(() => [
    ...atlasOutbound.value,
    ...resolveOutboundRoutes(document.value, toValue(uuid), toValue(family)).filter(entry => !atlasOutbound.value.some(row => row.carrier === entry.carrier)),
  ])
  const companionStatus = computed(() => {
    if (!connected.value)
      return ''
    if (atlas.value?.error)
      return 'RIPE Atlas 数据源配置无效'
    if (hasAtlasNode.value)
      return `${probeConnection.value} · RIPE Atlas`
    return isIPv4.value ? `${probeConnection.value} · ${probeSnapshot.value.nodes[toValue(uuid)]?.state ?? '等待助手'}` : ''
  })
  return { entries, outboundEntries, rawEvidence, protocolEvidence, companionStatus, hasAtlasNode, hasAtlasIPv6, visible: computed(() => app.returnRoutesVisible), configError: computed(() => app.returnRouteConfig.error) }
}
