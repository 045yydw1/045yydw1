/**
 * 测试专用：一个只实现文本帧的最小 OneBot WebSocket 服务端。
 * 足够验证握手、鉴权、收发 JSON、断线重连，不引入第三方依赖。
 */
import http from 'node:http'
import crypto from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
  let header
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length])
  } else if (data.length < 65_536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(data.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(data.length), 2)
  }
  return Buffer.concat([header, data])
}

export async function createMiniOneBotServer({ token = '', onAction } = {}) {
  const clients = new Set()
  const actions = []
  let connections = 0
  let parser

  const server = http.createServer((req, res) => {
    res.writeHead(400).end('websocket only')
  })

  function broadcast(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    for (const client of clients) client.socket.write(encodeFrame(0x1, text))
  }

  function dropClients() {
    for (const client of clients) client.socket.destroy()
    clients.clear()
  }

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const provided =
      url.searchParams.get('access_token') ||
      String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (token && provided !== token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const key = req.headers['sec-websocket-key']
    if (!key) {
      socket.destroy()
      return
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    connections += 1
    const client = { socket, buffer: Buffer.alloc(0) }
    clients.add(client)

    const respond = (action) => {
      const reply = { status: 'ok', retcode: 0, data: { message_id: actions.length }, echo: action.echo }
      socket.write(encodeFrame(0x1, JSON.stringify(reply)))
    }

    parser = (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk])
      for (;;) {
        const buffer = client.buffer
        if (buffer.length < 2) return
        const opcode = buffer[0] & 0x0f
        const masked = (buffer[1] & 0x80) !== 0
        let length = buffer[1] & 0x7f
        let offset = 2
        if (length === 126) {
          if (buffer.length < 4) return
          length = buffer.readUInt16BE(2)
          offset = 4
        } else if (length === 127) {
          if (buffer.length < 10) return
          length = Number(buffer.readBigUInt64BE(2))
          offset = 10
        }
        const maskLength = masked ? 4 : 0
        if (buffer.length < offset + maskLength + length) return
        let payload = buffer.subarray(offset + maskLength, offset + maskLength + length)
        if (masked) {
          const mask = buffer.subarray(offset, offset + 4)
          payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))
        }
        client.buffer = buffer.subarray(offset + maskLength + length)
        if (opcode === 0x1) {
          let action
          try {
            action = JSON.parse(payload.toString('utf8'))
          } catch {
            continue
          }
          actions.push(action)
          if (onAction) onAction(action, respond)
          else respond(action)
        } else if (opcode === 0x8) {
          socket.end()
          clients.delete(client)
          return
        } else if (opcode === 0x9) {
          socket.write(encodeFrame(0xa, payload))
        }
      }
    }

    socket.on('data', (chunk) => parser(chunk))
    socket.on('close', () => clients.delete(client))
    socket.on('error', () => clients.delete(client))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    url: `ws://127.0.0.1:${port}/`,
    get connections() {
      return connections
    },
    get clientCount() {
      return clients.size
    },
    actions,
    broadcast,
    dropClients,
    close: () =>
      new Promise((resolve) => {
        dropClients()
        server.close(() => resolve())
      }),
  }
}
