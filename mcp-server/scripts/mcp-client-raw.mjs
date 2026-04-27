import http from 'node:http'

const url = new URL('http://localhost:3001/mcp')

function postInit() {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'raw-client', version: '0.1.0' },
      },
    })

    const req = http.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream,application/json',
          'Transfer-Encoding': 'chunked',
        },
      },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {
          body += chunk
        })
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body })
        })
      },
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function postCall(sessionId) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'save_review',
        arguments: { agent_name: 'REVIEWER', model_name: 'raw-client', content: 'Added via raw client' },
      },
    })

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream,application/json',
      'Transfer-Encoding': 'chunked',
      'mcp-protocol-version': '2025-11-25',
    }
    if (sessionId) headers['mcp-session-id'] = sessionId

    const req = http.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers,
      },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
      },
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

;(async () => {
  try {
    console.log('POST initialize...')
    const init = await postInit()
    console.log('init status', init.status)
    console.log('init headers', init.headers)
    console.log('init body', init.body.slice(0, 1000))

    const sessionId = init.headers['mcp-session-id'] || null
    console.log('sessionId:', sessionId)

    console.log('POST call with sessionId...')
    const call = await postCall(sessionId)
    console.log('call status', call.status)
    console.log('call headers', call.headers)
    console.log('call body', call.body)
  } catch (err) {
    console.error('error', err)
  }
})()
