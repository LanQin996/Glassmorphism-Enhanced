<script setup lang="ts">
import type { PingAddressFamily } from '@/utils/carrierPing'
import { computed, ref, watch } from 'vue'
import ProtocolRouteEvidence from '@/components/ProtocolRouteEvidence.vue'
import ReturnRouteSummary from '@/components/ReturnRouteSummary.vue'
import { useNodeReturnRoutes } from '@/composables/useNodeReturnRoutes'
import { useAppStore } from '@/stores/app'
import { RETURN_CARRIER_NAMES } from '@/utils/returnRouteClassification'
import { returnRouteTime, summaryReturnRoutes } from '@/utils/returnRouteDisplay'

const props = defineProps<{
  uuid: string
  directional?: boolean
  family?: PingAddressFamily
  nodeIPv4?: boolean
  nodeIPv6?: boolean
}>()
const app = useAppStore()
const selectedFamily = ref<PingAddressFamily>('ipv4')
const canInspect = computed(() => app.privateFeaturesAllowed)
const family = computed<PingAddressFamily>(() => {
  if (props.family)
    return props.family
  if (props.nodeIPv4 !== props.nodeIPv6)
    return props.nodeIPv6 ? 'ipv6' : 'ipv4'
  return selectedFamily.value
})
const { entries, outboundEntries, visible, companionStatus, rawEvidence, protocolEvidence, hasAtlasNode, hasAtlasIPv6 } = useNodeReturnRoutes(() => props.uuid, family)
const canSelectFamily = computed(() => !props.family && props.nodeIPv4 === props.nodeIPv6
  && (hasAtlasIPv6.value || Boolean(app.returnRouteConfig.document.nodes[props.uuid]?.ipv6)))
watch(canSelectFamily, (canSelect) => {
  if (!canSelect)
    selectedFamily.value = 'ipv4'
})
const current = computed(() => summaryReturnRoutes(entries.value, canInspect.value))
const outbound = computed(() => summaryReturnRoutes(outboundEntries.value, canInspect.value))
const hasRoutes = computed(() => current.value.length > 0 || outbound.value.length > 0)
const showDirections = computed(() => props.directional || canSelectFamily.value || family.value === 'ipv6' || outbound.value.length > 0)
const sourceNames = { manual: '手动', auto: '自动', fixture: '模拟', replay: '历史实测回放' }
</script>

<template>
  <section v-if="visible && (hasRoutes || canSelectFamily || hasAtlasNode)" data-return-routes :data-route-node="uuid" :data-route-family="family" aria-label="线路信息" class="@container/route min-w-0" @click.stop @keydown.stop>
    <label v-if="canSelectFamily" class="mb-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
      <span>{{ app.lang === 'zh-CN' ? '线路协议' : 'Route protocol' }}</span>
      <select v-model="selectedFamily" class="rounded-md border border-border bg-card px-2 py-1">
        <option value="ipv4">IPv4</option>
        <option value="ipv6">IPv6</option>
      </select>
    </label>
    <details v-if="canInspect && (hasRoutes || hasAtlasNode)" class="group/routes min-w-0">
      <summary aria-label="查看线路详情" class="block cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <ReturnRouteSummary v-if="hasRoutes" :entries="current" :outbound="outbound" :directional="showDirections" />
        <span v-else class="text-xs text-muted-foreground">{{ app.lang === 'zh-CN' ? '暂无该协议的有效线路测量' : 'No valid measurements for this protocol' }}</span>
      </summary>
      <div class="mt-2 space-y-2 rounded-md border border-border/50 bg-slate-500/5 p-2 text-[10px] text-muted-foreground" data-route-details>
        <p>
          {{ family === 'ipv4' ? 'IPv4' : 'IPv6' }} 三网线路
        </p>
        <p v-if="companionStatus" data-companion-status>
          {{ companionStatus }}
        </p>
        <div v-for="entry in outboundEntries" :key="`outbound-${entry.carrier}`" class="space-y-1 break-words">
          <p>去程 · {{ RETURN_CARRIER_NAMES[entry.carrier] }} · {{ entry.label }} · <time :datetime="entry.at ?? undefined">{{ returnRouteTime(entry.at) }}</time></p>
          <p>{{ entry.detail }}</p>
        </div>
        <div v-for="entry in entries" :key="entry.carrier" class="space-y-1 break-words">
          <p>{{ RETURN_CARRIER_NAMES[entry.carrier] }} · {{ entry.label }} · {{ entry.source ? sourceNames[entry.source] : '无来源' }} · <time :datetime="entry.at ?? undefined">{{ returnRouteTime(entry.at) }}</time></p>
          <p>{{ entry.detail }}</p>
          <pre v-if="!entry.provider && rawEvidence?.[entry.carrier] && !protocolEvidence?.[entry.carrier]" class="max-h-40 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify(rawEvidence[entry.carrier], null, 2) }}</pre>
        </div>
        <ProtocolRouteEvidence :uuid="uuid" :routes="protocolEvidence" />
      </div>
    </details>
    <ReturnRouteSummary v-else-if="hasRoutes" :entries="current" :outbound="outbound" :directional="showDirections" />
    <p v-else class="text-xs text-muted-foreground">
      {{ app.lang === 'zh-CN' ? '暂无该协议的线路记录' : 'No routes for this protocol' }}
    </p>
  </section>
</template>
