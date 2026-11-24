'use strict'

const { CARRIERS, UUID, keys, publicV4 } = require('./protocol.cjs')

const ATLAS = 'https://atlas.ripe.net/api/v2/measurements'
const RIPESTAT = 'https://stat.ripe.net/data/network-info/data.json'
const DIRECTIONS = ['cn-to-node', 'node-to-cn']
const MAX_AGE = 7 * 86400000
const POLL_MS = 300000
const ROWS_PER_POLL = 8
const LOOKUPS_PER_POLL = 32
const GLOBAL_IPV6 = /^[23][\da-f:]{2,45}$/i
const RESERVED_IPV6 = /^(?:2001:db8:|3fff:|2002:)/i

function address(value, family) {
  if (typeof value !== 'string')
    return undefined
  if (family === 4)
    return publicV4(value) ? value : undefined
  // Only global unicast, with no zones, mapped IPv4, or example addresses.
  if (family !== 6 || !GLOBAL_IPV6.test(value))
    return undefined
  try {
    const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1)
    return RESERVED_IPV6.test(ip) ? undefined : ip
  }
  catch {
    return undefined
  }
}

function parseAtlasBindings(raw) {
  if (raw == null || raw === '')
    return []
  if (typeof raw === 'string' && raw.length > 65536)
    throw new TypeError('Atlas configuration exceeds its size limit')
  const nodes = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes) || Object.keys(nodes).length > 240)
    throw new TypeError('Atlas configurations must be keyed by node UUID')
  const bindings = []
  for (const [uuid, node] of Object.entries(nodes)) {
    keys(node, ['ipv4', 'ipv6', 'measurements'])
    if (!UUID.test(uuid) || !Array.isArray(node.measurements) || node.measurements.length > 12)
      throw new TypeError('invalid Atlas node configuration')
    const slots = new Set()
    for (const row of node.measurements) {
      keys(row, ['family', 'direction', 'carrier', 'measurementId', 'probeId', 'peer'])
      const { family, direction, carrier, measurementId, probeId } = row
      const nodeAddress = address(node[`ipv${family}`], family)
      const peer = address(row.peer, family)
      const slot = `${family}:${direction}:${carrier}`
      if (!nodeAddress || !peer || peer === nodeAddress || !DIRECTIONS.includes(direction) || !CARRIERS.includes(carrier)
        || !Number.isSafeInteger(measurementId) || measurementId <= 0 || !Number.isSafeInteger(probeId) || probeId <= 0 || slots.has(slot)) {
        throw new TypeError('invalid or duplicate Atlas route binding')
      }
      slots.add(slot)
      const [source, target] = direction === 'cn-to-node' ? [peer, nodeAddress] : [nodeAddress, peer]
      const key = JSON.stringify([uuid, slot, measurementId, probeId, source, target])
      bindings.push({ uuid, family, direction, carrier, measurementId, probeId, source, target, key })
      if (bindings.length > 240)
        throw new TypeError('too many Atlas route bindings')
    }
  }
  return bindings
}

function parseAtlasTrace(data, binding, now) {
  const samples = Array.isArray(data) ? data : data?.[binding.probeId]
  const sample = Array.isArray(samples)
    ? samples
      .filter(row => row?.prb_id === binding.probeId && row.msm_id === binding.measurementId && Number.isSafeInteger(row.timestamp))
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    : undefined
  if (!sample || sample.type !== 'traceroute' || sample.af !== binding.family
    || address(sample.dst_addr, binding.family) !== binding.target
    || ![sample.from, sample.src_addr].some(ip => address(ip, binding.family) === binding.source)
    || !Array.isArray(sample.result) || sample.result.length > 64) {
    return undefined
  }
  const collectedAtMs = sample.timestamp * 1000
  if (now - collectedAtMs > MAX_AGE || collectedAtMs - now > 300000)
    return undefined
  const hops = []
  const seen = new Set()
  for (const hop of sample.result) {
    if (!Number.isInteger(hop?.hop) || hop.hop < 1 || hop.hop > 64 || seen.has(hop.hop))
      return undefined
    seen.add(hop.hop)
    const replies = Array.isArray(hop.result) ? hop.result.slice(0, 8) : []
    const ips = [...new Set(replies.flatMap((reply) => {
      const ip = address(reply?.from, binding.family)
      const terminalUDP = reply?.err === 'p' && ip === binding.target
      return ip && (!reply.err || terminalUDP) && !reply.error ? [ip] : []
    }))].slice(0, 4)
    hops.push({ ttl: hop.hop, ips })
  }
  hops.sort((a, b) => a.ttl - b.ttl)
  const reachedTarget = sample.destination_ip_responded !== false && Boolean(hops.at(-1)?.ips.includes(binding.target))
  return { collectedAt: new Date(collectedAtMs).toISOString(), reachedTarget, hops }
}

function createAtlasCollector(request, now = Date.now) {
  const readings = new Map()
  const origins = new Map()
  let cursor = 0
  let refreshing = false

  async function get(url, signal) {
    if (signal?.aborted)
      throw new Error('Atlas pull stopped')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 5000)
    try {
      const response = await request(url, { redirect: 'error', signal: controller.signal, headers: { 'Accept': 'application/json', 'User-Agent': 'Glassmorphism-Enhanced-Atlas/1' } })
      if (!response.ok)
        throw new Error('Atlas data provider unavailable')
      const text = await response.text()
      if (text.length > 16384)
        throw new Error('Atlas response exceeds limit')
      return JSON.parse(text)
    }
    finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  async function refresh(raw, signal) {
    if (refreshing || signal?.aborted)
      return
    let bindings
    try {
      bindings = parseAtlasBindings(raw)
    }
    catch {
      return
    }
    const activeKeys = new Set(bindings.map(binding => binding.key))
    for (const key of readings.keys()) {
      if (!activeKeys.has(key))
        readings.delete(key)
    }
    if (!bindings.length)
      return

    refreshing = true
    let budget = LOOKUPS_PER_POLL
    async function lookup(ip) {
      const cached = origins.get(ip)
      if (cached && cached.expires > now())
        return cached.asns
      if (budget <= 0 || signal?.aborted)
        return []
      budget--
      try {
        const { data } = await get(`${RIPESTAT}?resource=${encodeURIComponent(ip)}`, signal)
        const asns = Array.isArray(data?.asns) ? [...new Set(data.asns.map(Number).filter(asn => Number.isInteger(asn) && asn > 0 && asn <= 4294967295))].slice(0, 4) : []
        if (origins.size >= 2048)
          origins.delete(origins.keys().next().value)
        origins.set(ip, { asns, expires: now() + (asns.length ? 8 * 3600000 : POLL_MS) })
        return asns
      }
      catch {
        return []
      }
    }

    try {
      for (let i = 0; i < Math.min(bindings.length, ROWS_PER_POLL) && !signal?.aborted; i++) {
        const binding = bindings[cursor++ % bindings.length]
        try {
          const sample = await get(`${ATLAS}/${binding.measurementId}/latest/?probe_ids=${binding.probeId}`, signal)
          const trace = parseAtlasTrace(sample, binding, now())
          const previous = readings.get(binding.key)
          if (!trace || trace.collectedAt < (previous?.collectedAt ?? ''))
            continue
          const hops = []
          for (const hop of trace.hops) {
            const asns = []
            if (trace.reachedTarget) {
              for (const ip of hop.ips)
                asns.push(...await lookup(ip))
            }
            hops.push({ ttl: hop.ttl, asns: [...new Set(asns)].slice(0, 4) })
          }
          if (!signal?.aborted) {
            const { family, direction, carrier } = binding
            const evidenceImproved = !previous || trace.collectedAt > previous.collectedAt
              || hops.filter(hop => hop.asns.length).length >= previous.hops.filter(hop => hop.asns.length).length
            if (evidenceImproved)
              readings.set(binding.key, { family, direction, carrier, collectedAt: trace.collectedAt, reachedTarget: trace.reachedTarget, hops })
          }
        }
        catch {
          // Neither retry the provider immediately nor replace a valid reading.
        }
      }
    }
    finally {
      refreshing = false
    }
  }

  function snapshot(raw) {
    let bindings
    try {
      bindings = parseAtlasBindings(raw)
    }
    catch {
      return { error: 'invalid-bindings', nodes: {} }
    }
    const nodes = {}
    for (const binding of bindings) {
      const rows = nodes[binding.uuid] ??= []
      const reading = readings.get(binding.key)
      if (reading)
        rows.push(reading)
    }
    return { nodes }
  }

  return { refresh, snapshot }
}

module.exports = { POLL_MS, createAtlasCollector, parseAtlasBindings, parseAtlasTrace }
