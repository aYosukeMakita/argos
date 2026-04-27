const url = 'http://localhost:3001/mcp'

async function initSession() {
  const initPayload = {
    jsonrpc: '2.0',
    id: 'init-1',
    method: 'initialize',
    params: {
      client: {
        accepts: ['application/json', 'text/event-stream'],
      },
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json,text/event-stream',
    },
    body: JSON.stringify(initPayload),
  })

  const sessionId = res.headers.get('mcp-session-id')
  const text = await res.text()
  return { status: res.status, sessionId, text }
}

async function callTool(sessionId) {
  const callPayload = {
    jsonrpc: '2.0',
    id: 'call-1',
    method: 'call',
    params: {
      tool: 'save_review',
      input: { agent_name: 'REVIEWER', model_name: 'mcp-script', content: 'Added via /mcp script' },
    },
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(callPayload),
  })

  const text = await res.text()
  return { status: res.status, text, headers: Object.fromEntries(res.headers) }
}

;(async () => {
  try {
    console.log('Initializing session...')
    const init = await initSession()
    console.log('init status', init.status)
    console.log('init sessionId header:', init.sessionId)
    console.log('init body:', init.text.slice(0, 1000))

    const sessionId = init.sessionId || null

    console.log('Calling save_review via /mcp...')
    const call = await callTool(sessionId)
    console.log('call status', call.status)
    console.log('call headers', call.headers)
    console.log('call body:', call.text)
  } catch (err) {
    console.error('error', err)
    process.exit(1)
  }
})()
