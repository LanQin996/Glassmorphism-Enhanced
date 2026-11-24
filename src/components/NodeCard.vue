<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type { NodeData } from '@/stores/nodes'
import { Icon } from '@iconify/vue'
import { useIntersectionObserver } from '@vueuse/core'
import { computed, ref, useTemplateRef } from 'vue'
import NodeHeaderTags from '@/components/NodeHeaderTags.vue'
import NodeReturnRoutes from '@/components/NodeReturnRoutes.vue'
import { CardX } from '@/components/ui/card-x'
import { DataTooltip } from '@/components/ui/data-tooltip'
import { ProgressThin } from '@/components/ui/progress-thin'

import { useNodeCarrierPingSource } from '@/composables/useNodeCarrierPingSource'
import { useNodeTraffic } from '@/composables/useNodeTraffic'
import { useAppStore } from '@/stores/app'
import { formatBytesPerSecondWithConfig, formatBytesWithConfig, formatDateTime, getStatus, getUptimeDays } from '@/utils/helper'
import { getDiskPercentage, getMemoryPercentage, hasTrafficLimit } from '@/utils/nodeMetricsHelper'
import { getOSImage, getOSName } from '@/utils/osImageHelper'
import { getRegionCode, getRegionDisplayName } from '@/utils/regionHelper'
import { formatCurrencyValue, formatPriceWithCycle, getDaysUntilExpired, getExpireStatus, getRemainingValue, isFreePrice } from '@/utils/tagHelper'

const props = withDefaults(defineProps<{
  node: NodeData
  reduceMotion?: boolean
  pingEnabled?: boolean
}>(), {
  reduceMotion: false,
  pingEnabled: true,
})
const emit = defineEmits<{
  click: []
  pingClick: []
}>()
const appStore = useAppStore()

const isFavorite = computed(() => appStore.isFavoriteNode(props.node.uuid))

function toggleFavorite(): void {
  appStore.toggleFavoriteNode(props.node.uuid)
}

function handleKeyboardOpen(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ')
    return
  event.preventDefault()
  emit('click')
}

interface RemainingInfoTag {
  icon: string
  text?: string
  prefix?: string
  value?: string
  unit?: string
  className?: string
}

const NODE_METRIC_ICONS = {
  cpu: 'tabler:cpu',
  memory: 'icon-park-outline:memory',
  disk: 'tabler:server-2',
  traffic: 'tabler:arrows-transfer-up-down',
} as const

const isMiniNodeCard = computed(() => appStore.nodeCardSize === 'mini')
const nodeCardXSize = computed(() => appStore.nodeCardSize === 'large' ? 'large' : 'medium')
const nodeCardContentClass = computed(() => isMiniNodeCard.value ? 'gap-2.5' : 'gap-4')
const pingMetrics = ['latency', 'loss'] as const
const carrierOrder = ['telecom', 'unicom', 'mobile'] as const

const formatBytes = (bytes: number) => formatBytesWithConfig(bytes, appStore.byteDecimals)
const formatBytesPerSecond = (bytes: number) => formatBytesPerSecondWithConfig(bytes, appStore.byteDecimals)
const offlineTime = computed(() => formatDateTime(props.node.time))

const cpuStatus = computed(() => getStatus(props.node.cpu ?? 0))
const memPercentage = computed(() => getMemoryPercentage(props.node))
const memStatus = computed(() => getStatus(memPercentage.value))
const swapTooltip = computed(() => {
  const used = formatBytes(Math.max(0, props.node.swap ?? 0))
  const total = Math.max(0, props.node.swap_total ?? 0)
  return total > 0 ? `Swap 已用 ${used} / 总计 ${formatBytes(total)}` : `Swap 已用 ${used}`
})
const diskPercentage = computed(() => getDiskPercentage(props.node))
const diskStatus = computed(() => getStatus(diskPercentage.value))

const pingRoot = useTemplateRef<ComponentPublicInstance>('pingRoot')
const pingVisible = ref(false)
const { isSupported } = useIntersectionObserver(
  pingRoot,
  (entries) => {
    pingVisible.value = entries.at(-1)?.isIntersecting ?? false
  },
  { rootMargin: '200px 0px' },
)
const { carrierDisplays, isTransit, family, families, selectedFamily } = useNodeCarrierPingSource(
  () => props.node,
  () => props.pingEnabled && (!isSupported.value || pingVisible.value),
)
const carrierRows = computed(() => [...carrierDisplays.value].sort(
  (left, right) => carrierOrder.indexOf(left.key) - carrierOrder.indexOf(right.key),
))

const { used: trafficUsed, percentage, remaining: trafficRemaining, label: trafficLabel, up: trafficUp, down: trafficDown, available: trafficReady, basis: trafficBasis } = useNodeTraffic(() => props.node)
const trafficUsedPercentage = computed(() => percentage.value ?? 0)
const trafficPercentageText = computed(() => !trafficReady.value ? '—' : hasTrafficLimit(props.node) ? `${trafficUsedPercentage.value.toFixed(1)}%` : '∞')
const trafficTooltip = computed(() => trafficBasis.value === 'machine-cumulative' ? '未设置流量周期；比例仅为累计参考，不是周期配额，不计算周期剩余额度' : !trafficReady.value ? '周期历史数据不足，未估算剩余额度' : trafficRemaining.value === null ? '本周期用量；未设置流量上限' : `本周期剩余 ${formatBytes(trafficRemaining.value)}`)

const nodeMessage = computed(() => props.node.message?.trim() ?? '')
const nodeMessageTooltip = computed(() => {
  const message = nodeMessage.value
  if (!message)
    return ''
  const updatedAt = props.node.status_updated_at ? `\n更新时间：${formatDateTime(props.node.status_updated_at)}` : ''
  return `${message}${updatedAt}`
})

// 流量状态颜色
const trafficStatus = computed(() => {
  if (!hasTrafficLimit(props.node))
    return 'success'

  if (trafficUsedPercentage.value >= 95)
    return 'error'
  if (trafficUsedPercentage.value >= 80)
    return 'warning'
  if (trafficUsedPercentage.value >= 60)
    return 'info'
  return 'success'
})

const trafficPercentageClass = computed(() => {
  if (!hasTrafficLimit(props.node))
    return 'text-muted-foreground'

  if (trafficUsedPercentage.value >= 95)
    return 'text-destructive'
  if (trafficUsedPercentage.value >= 80)
    return 'text-warning'
  if (trafficUsedPercentage.value >= 60)
    return 'text-warning'
  return 'text-success'
})

// 是否显示金额：未登录且开启「未登录隐藏价格」时不显示价格 / 剩余价值，
// 但在线天数、剩余天数等非金额信息仍然展示
const showPrice = computed(() => appStore.privateFeaturesAllowed || !appStore.hidePriceWhenLoggedOut)

const uptimeDaysText = computed(() => {
  const days = getUptimeDays(props.node.uptime)
  return appStore.lang === 'zh-CN' ? `在线 ${days} 天` : `${days} days online`
})

const priceText = computed(() => {
  const node = props.node
  if (node.price === 0 || !showPrice.value)
    return ''
  return formatPriceWithCycle(node.price, node.billing_cycle, node.currency, appStore.lang)
})

// 第三列：剩余天数（始终） + 剩余价值（仅在允许显示金额时），带图标与相邻列对齐
const remainingInfoTags = computed<RemainingInfoTag[]>(() => {
  const node = props.node
  const lang = appStore.lang
  const days = getDaysUntilExpired(node.expired_at)
  const status = getExpireStatus(node.expired_at)
  if (node.price === 0 && status === 'unknown')
    return []
  const items: RemainingInfoTag[] = []
  const expiryClass = status === 'expired' || status === 'critical'
    ? 'text-destructive'
    : status === 'warning' ? 'text-warning' : 'text-muted-foreground'

  if (status === 'unknown') {
    items.push({ icon: 'tabler:calendar-stats', text: '-', className: expiryClass })
  }
  else if (status === 'expired') {
    items.push({ icon: 'tabler:calendar-stats', text: lang === 'zh-CN' ? '已过期' : 'Expired', className: expiryClass })
  }
  else if (status === 'long_term') {
    items.push({ icon: 'tabler:calendar-stats', text: lang === 'zh-CN' ? '长期' : 'Long-term', className: expiryClass })
  }
  else if (lang === 'zh-CN') {
    items.push({ icon: 'tabler:calendar-stats', prefix: '剩余', value: String(days), unit: '天', className: expiryClass })
  }
  else {
    items.push({ icon: 'tabler:calendar-stats', prefix: 'left', value: String(days), unit: 'days', className: expiryClass })
  }

  if (node.price !== 0 && showPrice.value) {
    const text = isFreePrice(node.price)
      ? lang === 'zh-CN' ? '无' : 'N/A'
      : formatCurrencyValue(getRemainingValue(node.price, node.billing_cycle, node.expired_at), node.currency)
    items.push({ icon: 'tabler:coins', text })
  }
  return items
})

function getRegionAltText(region: string): string {
  return getRegionDisplayName(region) || getRegionCode(region)
}

function hasRegion(region: string | null | undefined): boolean {
  return Boolean(region?.trim())
}
</script>

<template>
  <CardX
    ref="pingRoot"
    hoverable
    :size="nodeCardXSize"
    :header-class="isMiniNodeCard ? 'px-3 pb-2' : 'pb-2'"
    :content-class="isMiniNodeCard ? 'px-3 pb-3' : 'pb-5'"
    class="node-card w-full cursor-pointer rounded-2xl border-border/35 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    :class="[!props.node.online && '!shadow-destructive/30']"
    role="button"
    tabindex="0"
    :aria-label="`查看节点 ${props.node.name} 详情`"
    @click="emit('click')"
    @keydown.self="handleKeyboardOpen"
  >
    <!-- 头部：在线点 + 名称 -->
    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <div class="relative size-2.5 shrink-0">
          <span
            class="size-2.5 rounded-full block"
            :class="props.node.online ? 'bg-success' : 'bg-destructive'"
          />
          <span
            v-if="!props.reduceMotion"
            class="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden"
            :class="props.node.online ? 'bg-success' : 'bg-destructive'"
          />
        </div>
        <span class="min-w-0 flex-1 truncate text-sm font-bold sm:text-[15px]">{{ props.node.name }}</span>
        <DataTooltip
          v-if="nodeMessage"
          :content="nodeMessageTooltip"
          placement="top"
          as="span"
          class="inline-flex shrink-0 text-amber-500"
          content-class="w-56 whitespace-pre-line leading-snug text-left"
        >
          <Icon icon="tabler:alert-triangle-filled" width="14" height="14" aria-label="节点消息" />
        </DataTooltip>
      </div>
    </template>

    <!-- 头部右侧：OS + 国旗 -->
    <template #header-extra>
      <div class="flex gap-1.5 items-center shrink-0">
        <button
          type="button"
          class="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-slate-500/10 hover:text-amber-500"
          :class="isFavorite && 'text-amber-500'"
          :aria-label="isFavorite ? `取消收藏 ${props.node.name}` : `收藏 ${props.node.name}`"
          :title="isFavorite ? '取消收藏' : '收藏节点'"
          @click.stop="toggleFavorite"
          @keydown.stop
        >
          <Icon :icon="isFavorite ? 'tabler:star-filled' : 'tabler:star'" width="14" height="14" />
        </button>
        <img :src="getOSImage(props.node.os)" :alt="getOSName(props.node.os)" class="size-4">
        <img
          v-if="hasRegion(props.node.region)"
          :src="`/images/flags/${getRegionCode(props.node.region)}.svg`"
          :alt="getRegionAltText(props.node.region)"
          class="size-5 shrink-0"
        >
      </div>
    </template>

    <template #default>
      <div class="flex flex-col relative" :class="nodeCardContentClass">
        <!-- 在线天数固定展示，价格独立展示，避免不同主机卡片高度不一致 -->
        <div data-node-header-meta class="relative z-20 flex min-w-0 items-start justify-between gap-2">
          <div class="flex min-w-0 max-w-[60%] flex-wrap items-center gap-1.5">
            <span class="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-slate-500/10 text-muted-foreground leading-tight">
              {{ uptimeDaysText }}
            </span>
            <span
              v-if="priceText"
              class="min-w-0 truncate text-[11px] px-2 py-0.5 rounded-full bg-slate-500/10 text-muted-foreground leading-tight"
            >
              {{ priceText }}
            </span>
          </div>
          <NodeHeaderTags :tags="props.node.tags" :visible="appStore.customTagsVisible" />
        </div>

        <!-- 四项进度条 -->
        <div v-if="isMiniNodeCard" class="grid grid-cols-[3fr_2fr] gap-x-4 gap-y-2">
          <div class="grid grid-cols-2 gap-x-3 gap-y-1">
            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-xs">
                <span class="inline-flex items-center text-sky-500" role="img" title="CPU" aria-label="CPU">
                  <Icon :icon="NODE_METRIC_ICONS.cpu" data-node-metric-icon="cpu" width="12" height="12" aria-hidden="true" />
                </span>
                <span class="tabular-nums font-medium">{{ (props.node.cpu ?? 0).toFixed(1) }}%</span>
              </div>
              <ProgressThin :percentage="props.node.cpu ?? 0" :status="cpuStatus" :height="4" />
            </div>

            <div class="flex flex-col gap-1" :title="swapTooltip">
              <div class="flex justify-between text-xs">
                <span class="inline-flex items-center text-emerald-500" role="img" title="内存" aria-label="内存">
                  <Icon :icon="NODE_METRIC_ICONS.memory" data-node-metric-icon="memory" width="12" height="12" aria-hidden="true" />
                </span>
                <span class="tabular-nums font-medium">{{ memPercentage.toFixed(1) }}%</span>
              </div>
              <ProgressThin :percentage="memPercentage" :status="memStatus" :height="4" />
            </div>

            <div class="col-span-2 text-[11px] text-muted-foreground truncate">
              {{ formatBytes(props.node.ram ?? 0) }} / {{ formatBytes(props.node.mem_total ?? 0) }}
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <div class="flex justify-between text-xs">
              <span class="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <Icon :icon="NODE_METRIC_ICONS.traffic" data-node-metric-icon="traffic" width="12" height="12" class="shrink-0 text-violet-500" aria-hidden="true" />
                <span class="truncate" :title="trafficTooltip">{{ trafficLabel }}</span>
              </span>
              <span class="tabular-nums font-medium" :class="trafficPercentageClass">
                {{ trafficPercentageText }}
              </span>
            </div>
            <ProgressThin v-if="hasTrafficLimit(props.node)" :percentage="trafficUsedPercentage" :status="trafficStatus" :height="4" :class="!trafficReady && 'opacity-30'" :aria-hidden="!trafficReady || undefined" />
            <div class="text-[11px] truncate" data-machine-traffic :data-traffic-basis="trafficBasis" :data-traffic-used="trafficUsed" :data-traffic-percentage="percentage" :data-traffic-remaining="trafficRemaining" :title="trafficTooltip" :class="trafficUsedPercentage >= 95 ? 'text-destructive' : 'text-muted-foreground'">
              {{ trafficUsed === null ? trafficLabel : formatBytes(trafficUsed) }}
              <template v-if="hasTrafficLimit(props.node)">
                / {{ formatBytes(props.node.traffic_limit) }}
              </template>
              <template v-else>
                / ∞
              </template>
            </div>
          </div>
        </div>

        <div v-else class="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <!-- CPU -->
          <div class="flex flex-col gap-1">
            <div class="flex justify-between text-xs">
              <span class="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <Icon :icon="NODE_METRIC_ICONS.cpu" data-node-metric-icon="cpu" width="13" height="13" class="shrink-0 text-sky-500" aria-hidden="true" />
                <span class="truncate">CPU</span>
              </span>
              <span class="tabular-nums font-medium">{{ (props.node.cpu ?? 0).toFixed(1) }}%</span>
            </div>
            <ProgressThin :percentage="props.node.cpu ?? 0" :status="cpuStatus" :height="4" />
            <div class="text-[11px] text-muted-foreground truncate">
              {{ (props.node.load ?? 0).toFixed(2) }}, {{ (props.node.load5 ?? 0).toFixed(2) }}, {{ (props.node.load15 ?? 0).toFixed(2) }}
            </div>
          </div>

          <!-- 内存 -->
          <div class="flex flex-col gap-1" :title="swapTooltip">
            <div class="flex justify-between text-xs">
              <span class="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <Icon :icon="NODE_METRIC_ICONS.memory" data-node-metric-icon="memory" width="13" height="13" class="shrink-0 text-emerald-500" aria-hidden="true" />
                <span class="truncate">内存</span>
              </span>
              <span class="tabular-nums font-medium">{{ memPercentage.toFixed(1) }}%</span>
            </div>
            <ProgressThin :percentage="memPercentage" :status="memStatus" :height="4" />
            <div class="text-[11px] text-muted-foreground truncate">
              {{ formatBytes(props.node.ram ?? 0) }} / {{ formatBytes(props.node.mem_total ?? 0) }}
            </div>
          </div>

          <!-- 硬盘 -->
          <div class="flex flex-col gap-1">
            <div class="flex justify-between text-xs">
              <span class="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <Icon :icon="NODE_METRIC_ICONS.disk" data-node-metric-icon="disk" width="13" height="13" class="shrink-0 text-orange-500" aria-hidden="true" />
                <span class="truncate">硬盘</span>
              </span>
              <span class="tabular-nums font-medium">{{ diskPercentage.toFixed(1) }}%</span>
            </div>
            <ProgressThin :percentage="diskPercentage" :status="diskStatus" :height="4" />
            <div class="text-[11px] text-muted-foreground truncate">
              {{ formatBytes(props.node.disk ?? 0) }} / {{ formatBytes(props.node.disk_total ?? 0) }}
            </div>
          </div>

          <!-- 流量（分级颜色） -->
          <div class="flex flex-col gap-1">
            <div class="flex justify-between text-xs">
              <span class="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <Icon :icon="NODE_METRIC_ICONS.traffic" data-node-metric-icon="traffic" width="13" height="13" class="shrink-0 text-violet-500" aria-hidden="true" />
                <span class="truncate" :title="trafficTooltip">{{ trafficLabel }}</span>
              </span>
              <span class="tabular-nums font-medium" :class="trafficPercentageClass">
                {{ trafficPercentageText }}
              </span>
            </div>
            <ProgressThin v-if="hasTrafficLimit(props.node)" :percentage="trafficUsedPercentage" :status="trafficStatus" :height="4" :class="!trafficReady && 'opacity-30'" :aria-hidden="!trafficReady || undefined" />
            <div class="text-[11px] truncate" data-machine-traffic :data-traffic-basis="trafficBasis" :data-traffic-used="trafficUsed" :data-traffic-percentage="percentage" :data-traffic-remaining="trafficRemaining" :title="trafficTooltip" :class="trafficUsedPercentage >= 95 ? 'text-destructive' : 'text-muted-foreground'">
              {{ trafficUsed === null ? trafficLabel : formatBytes(trafficUsed) }}
              <template v-if="hasTrafficLimit(props.node)">
                / {{ formatBytes(props.node.traffic_limit) }}
              </template>
              <template v-else>
                / ∞
              </template>
            </div>
          </div>
        </div>

        <!-- 三列：网速 / 总流量 / 剩余天数+价格或负载 -->
        <div class="grid grid-cols-3 gap-1.5">
          <!-- 实时网速 -->
          <div class="flex min-w-0 flex-col gap-0.5">
            <div class="text-[11px] text-success flex items-center gap-1">
              <Icon icon="tabler:chevron-up" width="11" height="11" />
              <span class="truncate min-w-0 overflow-hidden">{{ formatBytesPerSecond(props.node.net_out ?? 0) }}</span>
            </div>
            <div class="text-[11px] text-blue-600 flex items-center gap-1">
              <Icon icon="tabler:chevron-down" width="11" height="11" />
              <span class="truncate min-w-0 overflow-hidden">{{ formatBytesPerSecond(props.node.net_in ?? 0) }}</span>
            </div>
          </div>

          <!-- 总流量 -->
          <div class="flex min-w-0 flex-col gap-0.5">
            <div class="text-[11px] text-muted-foreground flex items-center gap-1" data-machine-direction="up">
              <Icon icon="tabler:upload" width="11" height="11" />
              <span class="truncate min-w-0 overflow-hidden">{{ trafficUp === null ? '—' : formatBytes(trafficUp ?? 0) }}</span>
            </div>
            <div class="text-[11px] text-muted-foreground flex items-center gap-1" data-machine-direction="down">
              <Icon icon="tabler:download" width="11" height="11" />
              <span class="truncate min-w-0 overflow-hidden">{{ trafficDown === null ? '—' : formatBytes(trafficDown ?? 0) }}</span>
            </div>
          </div>

          <!-- 第三列：有价格显示剩余天数+价格，否则显示负载 -->
          <div class="flex min-w-0 flex-col gap-0.5">
            <template v-if="remainingInfoTags.length">
              <div
                v-for="(item, i) in remainingInfoTags" :key="i"
                class="text-[11px] flex items-center gap-0.5"
                :class="item.className ?? 'text-muted-foreground'"
              >
                <Icon :icon="item.icon" width="11" height="11" class="shrink-0" />
                <span v-if="item.text" class="truncate min-w-0 overflow-hidden">{{ item.text }}</span>
                <template v-else>
                  <span v-if="item.prefix" class="shrink-0">{{ item.prefix }}</span>
                  <span v-if="item.value" class="shrink-0 tabular-nums">{{ item.value }}</span>
                  <span v-if="item.unit" class="shrink-0">{{ item.unit }}</span>
                </template>
              </div>
            </template>
            <template v-else-if="isMiniNodeCard">
              <div class="text-[11px] text-muted-foreground truncate">
                {{ (props.node.load ?? 0).toFixed(2) }}
              </div>
              <div class="text-[11px] text-muted-foreground truncate">
                {{ (props.node.load5 ?? 0).toFixed(2) }} / {{ (props.node.load15 ?? 0).toFixed(2) }}
              </div>
            </template>
          </div>
        </div>

        <div class="grid min-w-0 gap-1.5" :data-ping-family="isTransit ? undefined : family">
          <div v-if="isTransit || families.length > 1 || family === 'ipv6'" class="flex items-center justify-end gap-2">
            <span v-if="isTransit" class="text-[11px] text-muted-foreground">
              {{ appStore.lang === 'zh-CN' ? '中转估算' : 'Transit estimate' }}
            </span>
            <span v-if="families.length === 1 && family === 'ipv6'" class="rounded-md bg-foreground/5 px-2 py-0.5 text-[11px] text-muted-foreground">IPv6</span>
            <div v-if="families.length > 1" role="group" :aria-label="appStore.lang === 'zh-CN' ? '网络协议' : 'Network protocol'" class="inline-flex rounded-lg bg-foreground/5 p-0.5">
              <button
                v-for="option in families" :key="option"
                type="button"
                class="rounded-md px-2 py-1 text-[11px] leading-none text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                :class="family === option && 'bg-card/90 font-semibold text-foreground shadow-sm'"
                :aria-pressed="family === option"
                @click.stop="selectedFamily = option"
              >
                {{ option === 'ipv4' ? 'IPv4' : 'IPv6' }}
              </button>
            </div>
          </div>

          <div class="grid grid-cols-[minmax(0,1.28fr)_minmax(0,1fr)] gap-x-2.5">
            <button
              v-for="metric in pingMetrics" :key="metric"
              type="button"
              :data-node-ping-bars="metric"
              class="group/panel grid min-w-0 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              :class="!props.node.online && 'opacity-50'"
              :aria-label="`${props.node.name} 三网${metric === 'latency' ? '延迟' : '丢包'}监测`"
              @click.stop="emit('pingClick')"
            >
              <span
                v-for="carrier in carrierRows" :key="carrier.key"
                :data-carrier-ping="`${carrier.key}-${metric}`"
                class="grid min-h-6 min-w-0 items-center gap-1.5 text-[11px] leading-none tabular-nums"
                :class="metric === 'latency'
                  ? 'grid-cols-[minmax(0,2.1rem)_auto_minmax(0,1fr)]'
                  : 'grid-cols-[auto_minmax(0,1fr)]'"
                :title="metric === 'latency' ? carrier.latencyTooltip : carrier.lossTooltip"
              >
                <span v-if="metric === 'latency'" class="truncate text-foreground/80" :title="carrier.label">{{ carrier.label }}</span>
                <span data-ping-value class="whitespace-nowrap text-right font-medium" :class="metric === 'latency' ? 'min-w-[3.1rem]' : 'min-w-[2.7rem]'">
                  {{ metric === 'latency' ? carrier.latencyDisplay : carrier.lossDisplay }}
                </span>
                <span
                  class="grid h-2.5 min-w-0 gap-px"
                  :style="{ gridTemplateColumns: `repeat(${(metric === 'latency' ? carrier.latencyBars : carrier.lossBars).length}, minmax(0, 1fr))` }"
                >
                  <DataTooltip
                    v-for="bar in (metric === 'latency' ? carrier.latencyBars : carrier.lossBars)" :key="bar.key"
                    as="span" placement="top" :content="bar.tooltip" class="h-full min-w-0"
                  >
                    <span class="block h-full w-full rounded-[1px] group-hover/data-tooltip:outline-1 group-hover/data-tooltip:outline-ring" :class="bar.className" />
                  </DataTooltip>
                </span>
              </span>
            </button>
          </div>
        </div>
        <NodeReturnRoutes :uuid="props.node.uuid" :family="family" directional />

        <!-- 离线遮罩 -->
        <div
          v-if="!props.node.online"
          class="absolute inset-0 flex flex-col items-center justify-center z-10 rounded-xl bg-white/20 dark:bg-black/20 backdrop-blur-[2px]"
        >
          <div class="text-sm font-semibold text-destructive">
            离线
          </div>
          <div class="text-[11px] text-muted-foreground mt-1">
            {{ offlineTime }}
          </div>
        </div>
      </div>
    </template>
  </CardX>
</template>

<style scoped>
.node-card {
  position: relative;
  overflow: hidden;
}
</style>
