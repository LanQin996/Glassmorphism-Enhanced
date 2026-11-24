'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createAtlasCollector, parseAtlasBindings, parseAtlasTrace } = require('../../companion/enhanced-route-probe/atlas.cjs')

const UUID = '00000000-0000-4000-8000-000000000001'
const NOW = Date.parse('2026-11-24T12:00:00Z')
const AT = new Date(NOW - 60000).toISOString()
const node = {
  ipv4: '8.8.4.4',
  ipv6: '2606:4700:4700::1111',
  measurements: [4, 6].flatMap(family => ['cn-to-node', 'node-to-cn'].map((direction, i) => ({
    family,
    direction,
    measurementId: family * 10 + i,
    probeId: family * 100 + i,
    carrier: 'telecom',
    peer: family === 4 ? '219.141.140.10' : '240e:1f:2::3',
  }))),
}
const config = { [UUID]: node }

function sample(binding, changes = {}) {
  const result = {
    msm_id: binding.measurementId,
    prb_id: binding.probeId,
    type: 'traceroute',
    af: binding.family,
    from: binding.source,
    dst_addr: binding.target,
    timestamp: Date.parse(AT) / 1000,
    result: [
      { hop: 1, result: [{ from: binding.source }] },
      { hop: 2, result: [{ from: binding.target }] },
    ],
    ...changes,
  }
  return binding.family === 4 ? { [binding.probeId]: [result] } : [result]
}

test('metadata binds each measurement to an independent family, direction, and endpoint pair', () => {
  const bindings = parseAtlasBindings(JSON.stringify(config))
  assert.equal(new Set(bindings.map(b => b.key)).size, 4)
  assert.equal(bindings[0].source, node.measurements[0].peer)
  assert.equal(bindings[0].target, node.ipv4)
  assert.equal(bindings[3].source, node.ipv6)
  assert.equal(bindings[3].target, node.measurements[3].peer)
  const edited = measurements => ({ [UUID]: { ...node, measurements } })
  assert.throws(() => parseAtlasBindings(edited([node.measurements[0], node.measurements[0]])))
  assert.throws(() => parseAtlasBindings(edited([{ ...node.measurements[0], peer: '127.0.0.1' }])))
  assert.throws(() => parseAtlasBindings(edited([{ ...node.measurements[0], measurementId: 'https://example.test' }])))
  assert.throws(() => parseAtlasBindings(edited([{ ...node.measurements[2], peer: 'fe80::1' }])))
})

test('accepts the two latest-result response shapes and rejects mislabeled or stale samples', () => {
  for (const binding of parseAtlasBindings(config)) {
    assert.equal(parseAtlasTrace(sample(binding), binding, NOW).reachedTarget, true)
    assert.equal(parseAtlasTrace(sample(binding, { destination_ip_responded: false }), binding, NOW).reachedTarget, false)
    const terminal = reply => sample(binding, { result: [{ hop: 1, result: [{ from: binding.target, err: reply }] }] })
    assert.equal(parseAtlasTrace(terminal('p'), binding, NOW).reachedTarget, true)
    assert.equal(parseAtlasTrace(terminal('H'), binding, NOW).reachedTarget, false)
    for (const wrong of [
      { type: 'ping' },
      { af: binding.family === 4 ? 6 : 4 },
      { prb_id: 1 },
      { msm_id: 1 },
      { from: binding.target },
      { dst_addr: binding.source },
      { timestamp: NOW / 1000 + 600 },
      { timestamp: NOW / 1000 - 700000 },
    ])
      assert.equal(parseAtlasTrace(sample(binding, wrong), binding, NOW), undefined)
  }
})

test('collector uses only fixed read endpoints and exposes ASN evidence without addresses', async () => {
  const bindings = parseAtlasBindings(config)
  const requests = []
  let fail = false
  const collector = createAtlasCollector(async (url, options) => {
    const endpoint = new URL(url)
    requests.push(endpoint.hostname)
    assert.equal(options.method, undefined)
    assert.equal(options.redirect, 'error')
    if (fail)
      throw new Error('provider offline')
    if (endpoint.hostname === 'atlas.ripe.net') {
      const binding = bindings.find(row => endpoint.pathname === `/api/v2/measurements/${row.measurementId}/latest/`)
      assert.equal(endpoint.searchParams.get('probe_ids'), String(binding.probeId))
      return new Response(JSON.stringify(sample(binding)))
    }
    assert.equal(endpoint.hostname, 'stat.ripe.net')
    return new Response(JSON.stringify({ data: { asns: ['4134'] } }))
  }, () => NOW)
  await collector.refresh({})
  assert.deepEqual(requests, [])
  await collector.refresh(config)
  const snapshot = collector.snapshot(config)
  assert.equal(snapshot.nodes[UUID].length, 4)
  assert.ok(snapshot.nodes[UUID].every(row => row.collectedAt === AT && row.hops.every(hop => hop.asns[0] === 4134)))
  assert.equal(requests.filter(host => host === 'stat.ripe.net').length, 4)
  assert.ok(!JSON.stringify(snapshot).includes(node.ipv6))
  fail = true
  await collector.refresh(config)
  assert.deepEqual(collector.snapshot(config), snapshot)
  assert.deepEqual(collector.snapshot({}), { nodes: {} })
  const changed = { [UUID]: { ...node, measurements: [{ ...node.measurements[0], measurementId: 6000 }] } }
  assert.deepEqual(collector.snapshot(changed), { nodes: { [UUID]: [] } })
})
