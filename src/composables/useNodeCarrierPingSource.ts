import type { MaybeRefOrGetter } from 'vue'
import type { NodeData } from '@/stores/nodes'
import type { PingAddressFamily } from '@/utils/carrierPing'
import { computed, ref, toValue } from 'vue'
import { useNodeCarrierPingDisplay } from '@/composables/useNodeCarrierPingDisplay'
import { useNodePingDisplay } from '@/composables/useNodePingDisplay'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import { getPingAddressFamily, matchChinaCarrier } from '@/utils/carrierPing'
import { deriveTransitCarrierPing } from '@/utils/transitCarrierPing'

type TransitReason = 'relay-missing' | 'relay-offline' | 'records-disabled' | 'loading' | 'load-failed' | 'task-missing' | 'link-empty'

function formatTransitReason(reason: TransitReason, isZh: boolean): string {
  if (isZh) {
    return {
      'relay-missing': '未找到配置的中转节点（名称需唯一）',
      'relay-offline': '中转节点离线',
      'records-disabled': '未启用 Ping 记录',
      'loading': '加载中',
      'load-failed': '中转数据加载失败',
      'task-missing': '未找到中转链路 Ping 任务（名称需唯一）',
      'link-empty': '中转链路没有数据',
    }[reason]
  }
  return {
    'relay-missing': 'Configured relay node not found (name must be unique)',
    'relay-offline': 'Relay node is offline',
    'records-disabled': 'Ping records disabled',
    'loading': 'Loading',
    'load-failed': 'Relay data failed to load',
    'task-missing': 'Relay link Ping task not found (name must be unique)',
    'link-empty': 'Relay link has no data',
  }[reason]
}

/** Select one source only; relay subscriptions use the same cache key as its own card. */
export function useNodeCarrierPingSource(node: MaybeRefOrGetter<NodeData>, enabled: MaybeRefOrGetter<boolean>) {
  const app = useAppStore()
  const nodes = useNodesStore()
  const rule = computed(() => app.transitCarrierPingEnabled
    ? app.transitCarrierPingRules.find(rule => rule.target === toValue(node).name)
    : undefined)
  const relay = computed(() => {
    const matches = nodes.visibleNodes.filter(node => node.name === rule.value?.relay)
    return matches.length === 1 ? matches[0] : undefined
  })
  const isTransit = computed(() => !!rule.value)
  const sourceUuid = computed(() => rule.value ? relay.value?.uuid ?? '' : toValue(node).uuid)
  const display = useNodePingDisplay(sourceUuid, {
    enabled: () => toValue(enabled) && (!isTransit.value || relay.value?.online === true),
  })
  const selectedFamily = ref<PingAddressFamily>('ipv4')
  const carrierTasks = computed(() => display.pingStats.taskStats.value
    .filter(task => task.assigned !== false && matchChinaCarrier(task.name))
    .map(task => ({ task, family: getPingAddressFamily(task) })))
  const reportedIPv4 = computed(() => Boolean(toValue(node).ipv4?.trim()))
  const reportedIPv6 = computed(() => Boolean(toValue(node).ipv6?.trim()))
  const ipv6Only = computed(() => reportedIPv6.value && !reportedIPv4.value)
  const families = computed<PingAddressFamily[]>(() => {
    if (ipv6Only.value)
      return ['ipv6']
    if (reportedIPv6.value)
      return ['ipv4', 'ipv6']
    if (reportedIPv4.value)
      return ['ipv4']
    // Guest views can omit both address fields.
    const configuredIPv6 = app.returnRouteConfig.document.nodes[toValue(node).uuid]?.ipv6
    const observedIPv6 = !isTransit.value && carrierTasks.value.some(({ family, task }) => family === 'ipv6' && task.hasLatency)
    return configuredIPv6 || observedIPv6 ? ['ipv4', 'ipv6'] : ['ipv4']
  })
  const family = computed(() => families.value.includes(selectedFamily.value) ? selectedFamily.value : (families.value[0] ?? 'ipv4'))
  const directTasks = computed(() => carrierTasks.value
    .filter(task => (task.family ?? 'ipv4') === family.value)
    .map(({ task }) => task))
  const transit = computed(() => {
    if (!rule.value)
      return undefined
    const tasks = display.pingStats.taskStats.value
    const links = tasks.filter(task => task.name === rule.value?.task)
    const reasonKey: TransitReason | undefined = !relay.value
      ? 'relay-missing'
      : !relay.value.online
          ? 'relay-offline'
          : !display.pingStatsEnabled.value
              ? 'records-disabled'
              : display.pingStats.loading.value
                ? 'loading'
                : display.pingStats.error.value
                  ? 'load-failed'
                  : links.length > 1 || (links.length === 0 && !display.pingStats.knownTaskNames.value.includes(rule.value.task))
                    ? 'task-missing'
                    : !links[0]?.stats.hasData
                        ? 'link-empty'
                        : undefined
    const reason = reasonKey ? formatTransitReason(reasonKey, app.lang === 'zh-CN') : ''
    return {
      relay: rule.value.relay,
      task: rule.value.task,
      reason,
      carriers: deriveTransitCarrierPing(reason ? [] : tasks, rule.value.task),
    }
  })
  const { carrierDisplays } = useNodeCarrierPingDisplay(
    { ...display.pingStats, taskStats: directTasks },
    display.pingStatsEnabled,
    transit,
  )
  return { carrierDisplays, isTransit, family, families, selectedFamily }
}
