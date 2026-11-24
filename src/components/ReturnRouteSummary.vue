<script setup lang="ts">
import type { ReturnRouteDisplay } from '@/utils/returnRoutes'
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { formatDateTime } from '@/utils/helper'
import { RETURN_CARRIER_NAMES, RETURN_CARRIERS } from '@/utils/returnRouteClassification'

// Presentation only: show the full label, never abbreviate, clamp or ellipsize.
const props = defineProps<{ entries: ReturnRouteDisplay[], outbound: ReturnRouteDisplay[], directional: boolean }>()
const ordered = computed(() => (['unicom', 'telecom', 'mobile'] as const).flatMap(carrier => props.entries.filter(entry => entry.carrier === carrier)))
const markers = { unicom: 'bg-red-500/80', telecom: 'bg-blue-500/80', mobile: 'bg-green-500/80' }
const columns = { unicom: 1, telecom: 2, mobile: 3 }
const app = useAppStore()
const isZh = computed(() => app.lang === 'zh-CN')
const carrierEnglish = { telecom: 'Telecom', unicom: 'Unicom', mobile: 'Mobile' }
const routeRows = computed(() => RETURN_CARRIERS.map(carrier => ({
  carrier,
  outbound: props.outbound.find(entry => entry.carrier === carrier),
  inbound: props.entries.find(entry => entry.carrier === carrier),
})))
const lastTest = computed(() => [...props.entries, ...props.outbound].flatMap(entry => entry.source === 'auto' && entry.at ? [entry.at] : []).sort().at(-1))
const hasManual = computed(() => props.outbound.length > 0 || props.entries.some(entry => entry.source === 'manual'))
</script>

<template>
  <span v-if="directional" data-route-summary class="block min-w-0 text-[11px] leading-4 tabular-nums">
    <span class="mb-1 flex flex-wrap items-center justify-between gap-x-2">
      <span class="font-semibold text-foreground">{{ isZh ? '三网线路' : 'Carrier routes' }}</span>
      <time v-if="lastTest" :datetime="lastTest" class="text-muted-foreground">
        {{ isZh ? '最近测试' : 'Last test' }} {{ formatDateTime(lastTest, 'MM-DD HH:mm') }}
      </time>
      <span v-else-if="hasManual" class="text-muted-foreground">{{ isZh ? '手动标注' : 'Manual' }}</span>
    </span>
    <span role="table" :aria-label="isZh ? '三网去程和回程' : 'Outbound and return routes'" class="grid min-w-0 gap-y-1">
      <span role="row" class="grid grid-cols-[2.6rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-1.5 text-center text-muted-foreground sm:gap-x-2">
        <span role="columnheader" class="sr-only">{{ isZh ? '运营商' : 'Carrier' }}</span>
        <span role="columnheader" class="col-start-2">{{ isZh ? '去程' : 'Outbound' }}</span>
        <span role="columnheader">{{ isZh ? '回程' : 'Return' }}</span>
      </span>
      <span
        v-for="row in routeRows" :key="row.carrier"
        role="row" :data-route-row="row.carrier"
        class="grid grid-cols-[2.6rem_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-x-1.5 sm:gap-x-2"
      >
        <span role="rowheader" class="self-center truncate text-foreground/80" :title="isZh ? RETURN_CARRIER_NAMES[row.carrier] : carrierEnglish[row.carrier]">
          {{ isZh ? RETURN_CARRIER_NAMES[row.carrier] : carrierEnglish[row.carrier] }}
        </span>
        <span
          role="cell"
          :data-outbound-carrier="row.outbound ? row.carrier : undefined"
          :data-route-status="row.outbound?.status"
          :title="row.outbound?.label"
          class="min-w-0 content-center rounded-md px-1 py-0.5 text-center font-semibold [overflow-wrap:anywhere]"
          :class="row.outbound ? 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-300' : 'bg-foreground/4 text-muted-foreground'"
        >
          <span v-if="row.outbound" data-route-label>{{ row.outbound.label }}</span>
          <template v-else>—</template>
        </span>
        <span
          role="cell"
          :data-return-carrier="row.inbound ? row.carrier : undefined"
          :data-route-status="row.inbound?.status"
          :title="row.inbound?.label"
          class="min-w-0 content-center rounded-md px-1 py-0.5 text-center font-semibold [overflow-wrap:anywhere]"
          :class="row.inbound ? 'bg-amber-500/12 text-amber-800 dark:text-amber-300' : 'bg-foreground/4 text-muted-foreground'"
        >
          <span v-if="row.inbound" data-route-label>{{ row.inbound.label }}</span>
          <template v-else>—</template>
        </span>
      </span>
    </span>
  </span>
  <span v-else data-route-summary class="grid w-full min-w-0 grid-cols-3 gap-0 text-[11px] leading-4 text-muted-foreground tabular-nums @max-[240px]/route:text-[10px]">
    <span
      v-for="entry in ordered" :key="entry.carrier"
      :data-return-carrier="entry.carrier" :data-route-status="entry.status"
      :aria-label="`${RETURN_CARRIER_NAMES[entry.carrier]}线路 ${entry.label}`"
      :title="`${entry.label} · ${entry.source === 'manual' ? '管理员手动标注' : '管理员可见的当前观测'}，非商业线路认证`"
      :style="{ gridColumn: columns[entry.carrier] }"
      class="flex min-w-0 items-start justify-center text-center text-foreground/75"
    >
      <span data-route-group class="inline-flex min-w-0 max-w-full items-center gap-[3px]">
        <span aria-hidden="true" data-carrier-marker class="inline-block size-[5px] shrink-0 rounded-full" :class="markers[entry.carrier]" />
        <span data-route-label class="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ entry.label }}</span>
      </span>
    </span>
  </span>
</template>
