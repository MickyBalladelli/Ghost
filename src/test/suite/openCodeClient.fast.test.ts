import * as assert from 'node:assert'

import { isSupportedOpenCodeVersion, OpenCodeClient } from '../../services/openCodeClient'

const jsonResponse = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' }
})

suite('OpenCode client', () => {
  test('accepts compatible 1.x versions and rejects another major', () => {
    assert.equal(isSupportedOpenCodeVersion('1.0.0'), true)
    assert.equal(isSupportedOpenCodeVersion('v1.18.4'), true)
    assert.equal(isSupportedOpenCodeVersion('0.9.9'), false)
    assert.equal(isSupportedOpenCodeVersion('2.0.0'), false)
  })

  test('discovers connected provider/model ids', async () => {
    const client = new OpenCodeClient('http://127.0.0.1:4096', {
      fetchImpl: async input => {
        const url = new URL(String(input))
        assert.equal(url.pathname, '/provider')
        return jsonResponse({
          connected: ['local'],
          all: [
            { id: 'local', models: { coder: { id: 'coder' }, chat: { modelID: 'chat' } } },
            { id: 'offline', models: { hidden: { id: 'hidden' } } }
          ]
        })
      }
    })

    assert.deepEqual(await client.listModels(), ['local/chat', 'local/coder'])
  })

  test('uses Basic Auth on loopback and rejects credentials over remote HTTP', async () => {
    let authorization = ''
    const local = new OpenCodeClient('http://127.0.0.1:4096', {
      username: 'ghost',
      password: () => 'secret',
      fetchImpl: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization') ?? ''
        return jsonResponse({ connected: [], all: [] })
      }
    })
    await local.listModels()
    assert.equal(authorization, `Basic ${Buffer.from('ghost:secret').toString('base64')}`)

    const remote = new OpenCodeClient('http://example.com:4096', {
      password: () => 'secret',
      fetchImpl: async () => jsonResponse({ connected: [], all: [] })
    })
    await assert.rejects(remote.listModels(), /will not send an OpenCode password/)
  })

  test('runs a workspace-scoped session and reads its final diff', async () => {
    const requested: Array<{ path: string; directory?: string; method?: string }> = []
    const client = new OpenCodeClient('http://127.0.0.1:4096', {
      fetchImpl: async (input, init) => {
        const url = new URL(String(input))
        requested.push({ path: url.pathname, directory: url.searchParams.get('directory') ?? undefined, method: init?.method })
        if (url.pathname === '/global/health') return jsonResponse({ healthy: true, version: '1.18.4' })
        if (url.pathname === '/config') return jsonResponse({ permission: { edit: 'ask', bash: 'ask', external_directory: 'deny' } })
        if (url.pathname === '/session' && init?.method === 'POST') {
          return jsonResponse({ id: 'ses_test', directory: '/workspace', title: 'Ghost' })
        }
        if (url.pathname === '/event') return new Response('data: {"type":"server.connected","properties":{}}\n\n')
        if (url.pathname === '/session/ses_test/message') {
          return jsonResponse({ parts: [{ type: 'text', text: 'Done' }] })
        }
        if (url.pathname === '/session/ses_test/diff') return jsonResponse([{ file: 'src/app.ts' }])
        return jsonResponse({ message: 'missing route' }, 404)
      }
    })

    const result = await client.run({ prompt: 'Update app', directory: '/workspace' })

    assert.equal(result.sessionId, 'ses_test')
    assert.equal(result.text, 'Done')
    assert.deepEqual(result.changedFiles, ['src/app.ts'])
    assert.equal(requested.every(item => item.path === '/global/health' || item.directory === '/workspace'), true)
  })

  test('rejects permissive OpenCode mutation defaults', async () => {
    const methods: string[] = []
    const client = new OpenCodeClient('http://127.0.0.1:4096', {
      fetchImpl: async (input, init) => {
        const url = new URL(String(input))
        methods.push(init?.method ?? 'GET')
        if (url.pathname === '/global/health') return jsonResponse({ healthy: true, version: '1.18.4' })
        if (url.pathname === '/config') return jsonResponse({})
        return jsonResponse({}, 404)
      }
    })

    await assert.rejects(
      client.run({ prompt: 'Edit file', directory: '/workspace' }),
      /requires guarded edit, bash, and external-directory permissions/
    )
    assert.equal(methods.includes('PATCH'), false)
  })

  test('answers session permission events with a one-request response', async () => {
    let replyBody: unknown
    const client = new OpenCodeClient('http://127.0.0.1:4096', {
      fetchImpl: async (input, init) => {
        const url = new URL(String(input))
        if (url.pathname === '/global/health') return jsonResponse({ healthy: true, version: '1.18.4' })
        if (url.pathname === '/config') return jsonResponse({ permission: { edit: 'ask', bash: 'ask', external_directory: 'deny' } })
        if (url.pathname === '/session' && init?.method === 'POST') return jsonResponse({ id: 'ses_permission', directory: '/workspace' })
        if (url.pathname === '/event') {
          return new Response('data: {"type":"permission.updated","properties":{"id":"per_1","sessionID":"ses_permission","type":"edit","title":"Edit app","metadata":{"filePath":"src/app.ts"}}}\n\n')
        }
        if (url.pathname === '/session/ses_permission/permissions/per_1') {
          replyBody = JSON.parse(String(init?.body)) as unknown
          return jsonResponse(true)
        }
        if (url.pathname === '/session/ses_permission/message') return jsonResponse({ parts: [{ type: 'text', text: 'Done' }] })
        if (url.pathname === '/session/ses_permission/diff') return jsonResponse([])
        return jsonResponse({}, 404)
      }
    })

    const result = await client.run({
      prompt: 'Update app',
      directory: '/workspace',
      onPermission: async permission => permission.id === 'per_1' ? 'once' : 'reject'
    })

    assert.equal(result.text, 'Done')
    assert.deepEqual(replyBody, { response: 'once' })
  })
})
