#!/usr/bin/env node
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const frontendPortFile = path.join(rootDir, ".dev-frontend-port")
const apiPortFile = path.join(rootDir, "server", ".dev-api-port")

function readPort(filePath, label) {
  const raw = fs.readFileSync(filePath, "utf8").trim()
  const port = Number.parseInt(raw, 10)
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`${label} port file is invalid: ${raw}`)
  }
  return port
}

function tcpOpens(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (!done) {
        done = true
        resolve(value)
      }
    }
    const socket = net.createConnection({ host, port }, () => {
      socket.destroy()
      finish(true)
    })
    socket.setTimeout(timeoutMs)
    socket.once("timeout", () => {
      socket.destroy()
      finish(false)
    })
    socket.once("error", () => finish(false))
  })
}

const frontendPort = readPort(frontendPortFile, "frontend")
const apiPort = readPort(apiPortFile, "api")

const frontendReady = await tcpOpens("127.0.0.1", frontendPort)
const apiReady = await tcpOpens("127.0.0.1", apiPort)

if (!frontendReady || !apiReady) {
  throw new Error(
    `dev server is not ready: frontend ${frontendPort}=${frontendReady}, api ${apiPort}=${apiReady}`,
  )
}

if (frontendPort !== 5173) {
  throw new Error(`frontend should be fixed on 5173, got ${frontendPort}`)
}

console.log(`dev ports ok: frontend=http://127.0.0.1:${frontendPort}, api=http://127.0.0.1:${apiPort}`)
