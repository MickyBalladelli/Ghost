import * as assert from 'node:assert'

import { isSupportedOpenCodeVersion, OpenCodeClient, OpenCodePolicyRejectionError, OpenCodeRuleDenialError } from '../../services/openCodeClient'
import { TERMINAL_FILE_WRITE_BLOCK_REASON } from '../../tools/terminalAudit'

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
        if (url.pathname === '/config/providers') return jsonResponse({}, 404)
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

  test('discovers models from the current config providers endpoint', async () => {
    const client = new OpenCodeClient('http://127.0.0.1:4096', {
      fetchImpl: async input => {
        const url = new URL(String(input))
        assert.equal(url.pathname, '/config/providers')
        return jsonResponse({
          providers: [{
            id: 'opencode',
            models: {
              'gpt-5.1': { id: 'gpt-5.1', name: 'GPT-5.1', limit: { context: 400000, output: 128000 } }
            }
          }]
        })
      }
    })

    assert.deepEqual(await client.listModels(), ['opencode/gpt-5.1'])
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

  test('preserves structured OpenCode session errors', async () => {
    const client = new OpenCodeClient('http://127.0.0.1:4096', {
      fetchImpl: async (input, init) => {
        const url = new URL(String(input))
        if (url.pathname === '/global/health') return jsonResponse({ healthy: true, version: '1.18.4' })
        if (url.pathname === '/config') return jsonResponse({ permission: { edit: 'ask', bash: 'ask', external_directory: 'deny' } })
        if (url.pathname === '/session' && init?.method === 'POST') return jsonResponse({ id: 'ses_error', directory: '/workspace' })
        if (url.pathname === '/event') {
          return new Response('data: {"type":"session.error","properties":{"sessionID":"ses_error","error":{"message":"Provider failed","name":"ProviderAuthError","data":{"message":"OpenCode provider API key is invalid"}}}}\n\n')
        }
        return jsonResponse(true)
      }
    })

    await assert.rejects(
      client.run({ prompt: 'Explain app', directory: '/workspace' }),
      /OpenCode provider API key is invalid/
    )
  })

  test('throws a typed error with the session id when Ghost rejects a terminal file write', async () => {
    let replyBody: unknown
    const client = new OpenCodeClient('http://127.0.0.1:4096', {
      fetchImpl: async (input, init) => {
        const url = new URL(String(input))
        if (url.pathname === '/global/health') return jsonResponse({ healthy: true, version: '1.18.4' })
        if (url.pathname === '/config') return jsonResponse({ permission: { edit: 'ask', bash: 'ask', external_directory: 'deny' } })
        if (url.pathname === '/session' && init?.method === 'POST') return jsonResponse({ id: 'ses_reject', directory: '/workspace' })
        if (url.pathname === '/event') {
          return new Response(
            'data: {"type":"permission.updated","properties":{"id":"per_bash","sessionID":"ses_reject","type":"bash","title":"Run command","metadata":{"command":"echo hi > out.txt"}}}\n\n'
            + 'data: {"type":"message.part.updated","properties":{"sessionID":"ses_reject","part":{"type":"tool","tool":"bash","state":{"status":"error","error":{"message":"Tool bash failed: user rejected permission"}}}}}\n\n'
          )
        }
        if (url.pathname === '/session/ses_reject/permissions/per_bash') {
          replyBody = JSON.parse(String(init?.body)) as unknown
          return jsonResponse(true)
        }
        if (url.pathname === '/session/ses_reject/message') {
          await new Promise(resolve => setTimeout(resolve, 20))
          return jsonResponse({ parts: [] })
        }
        if (url.pathname === '/session/ses_reject/diff') return jsonResponse([])
        return jsonResponse({}, 404)
      }
    })

    try {
      await client.run({
        prompt: 'Write file',
        directory: '/workspace',
        onPermission: async () => ({ response: 'reject', reason: TERMINAL_FILE_WRITE_BLOCK_REASON })
      })
      assert.fail('expected the run to fail after the policy rejection')
    } catch (error) {
      assert.ok(error instanceof OpenCodePolicyRejectionError)
      assert.equal(error.sessionId, 'ses_reject')
      assert.equal(error.reason, TERMINAL_FILE_WRITE_BLOCK_REASON)
      assert.match(error.message, /OpenCode bash failed: Terminal file writes are disabled/)
    }
    assert.deepEqual(replyBody, { response: 'reject' })
  })

  test('throws a typed rule-denial error when the server blocks an outside-workspace call', async () => {
    const client = new OpenCodeClient('http://127.0.0.1:4096', {
      fetchImpl: async (input, init) => {
        const url = new URL(String(input))
        if (url.pathname === '/global/health') return jsonResponse({ healthy: true, version: '1.18.4' })
        if (url.pathname === '/config') return jsonResponse({ permission: { edit: 'ask', bash: 'ask', external_directory: 'deny' } })
        if (url.pathname === '/session' && init?.method === 'POST') return jsonResponse({ id: 'ses_denied', directory: '/workspace' })
        if (url.pathname === '/event') {
          return new Response(
            'data: {"type":"message.part.updated","properties":{"sessionID":"ses_denied","part":{"type":"tool","tool":"bash","state":{"status":"error","error":{"message":"The user has specified a rule which prevents you from using this specific tool call. Relevant rules: [{\\"permission\\":\\"external_directory\\",\\"action\\":\\"deny\\"}]"}}}}}\n\n'
          )
        }
        if (url.pathname === '/session/ses_denied/message') {
          await new Promise(resolve => setTimeout(resolve, 20))
          return jsonResponse({ parts: [] })
        }
        if (url.pathname === '/session/ses_denied/diff') return jsonResponse([])
        return jsonResponse({}, 404)
      }
    })

    try {
      await client.run({ prompt: 'List parent directory', directory: '/workspace' })
      assert.fail('expected the run to fail after the rule denial')
    } catch (error) {
      assert.ok(error instanceof OpenCodeRuleDenialError)
      assert.equal(error.sessionId, 'ses_denied')
      assert.match(error.message, /OpenCode bash failed: The user has specified a rule/)
    }
  })
})
