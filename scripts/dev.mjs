#!/usr/bin/env node
/**
 * Starts the Python API (from server/), waits until it listens and writes `.dev-api-port`,
 * then starts Vite so `/api` always targets the resolved backend port.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolvePythonCommand } from "./python-runtime.mjs"

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const serverDir = path.join(rootDir, "server")
const devPortFile = path.join(serverDir, ".dev-api-port")
const devFrontendPortFile = path.join(rootDir, ".dev-frontend-port")
const frontendPort = Number.parseInt(process.env.FRONTEND_PORT || process.env.VITE_DEV_PORT || "5173", 10)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readChosenPortFromFile() {
  try {
    const raw = fs.readFileSync(devPortFile, "utf8").trim()
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 1 && n <= 65535) return n
  } catch {}
  return null
}

function tcpOpens(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (!done) {
        done = true
        resolve(value)
      }
    }

    const s = net.createConnection({ host, port }, () => {
      s.destroy()
      finish(true)
    })
    s.setTimeout(timeoutMs)
    s.once("timeout", () => {
      s.destroy()
      finish(false)
    })
    s.once("error", () => finish(false))
  })
}

async function waitUntilBackendReachable(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const portNum = readChosenPortFromFile()
    if (portNum !== null && (await tcpOpens("127.0.0.1", portNum))) {
      return portNum
    }
    await sleep(250)
  }
  throw new Error(
    "timed out waiting for Python API (.dev-api-port + TCP probe). Check PostgreSQL / server logs.",
  )
}

async function removeDevPortStub() {
  try {
    await fs.promises.unlink(devPortFile)
  } catch {
    /* non-fatal */
  }
  try {
    await fs.promises.unlink(devFrontendPortFile)
  } catch {
    /* non-fatal */
  }
}

await removeDevPortStub()

if (!Number.isFinite(frontendPort) || frontendPort < 1 || frontendPort > 65535) {
  console.error("[dev] FRONTEND_PORT must be a valid TCP port.")
  process.exit(1)
}

if (await tcpOpens("127.0.0.1", frontendPort)) {
  console.error(
    `[dev] frontend port ${frontendPort} is already in use. Stop the old dev server first, then run npm run dev again.`,
  )
  process.exit(1)
}

let viteStarted = false

let pythonCommand
try {
  pythonCommand = resolvePythonCommand(rootDir)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const pyProc = spawn(pythonCommand, ["-m", "app.main"], {
  cwd: serverDir,
  stdio: "inherit",
  env: process.env,
})

pyProc.on("exit", (code, signal) => {
  if (!viteStarted && code !== 0 && signal == null) {
    console.error(`[dev] backend exited (${code}); not starting Vite.`)
    process.exit(code ?? 1)
  }
})

let apiPort = null

try {
  apiPort = await waitUntilBackendReachable(120_000)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  try {
    pyProc.kill("SIGTERM")
  } catch {}
  process.exit(1)
}

const apiUrl = `http://127.0.0.1:${apiPort}`
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js")

await fs.promises.writeFile(devFrontendPortFile, String(frontendPort))

const viteProc = spawn(
  process.execPath,
  [viteBin, "--configLoader", "native", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_API_PROXY_TARGET: apiUrl,
    },
  },
)

viteStarted = true

function shutdown() {
  try {
    viteProc.kill("SIGTERM")
  } catch {}
  try {
    pyProc.kill("SIGTERM")
  } catch {}
  void removeDevPortStub()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

viteProc.on("exit", (code) => {
  try {
    pyProc.kill("SIGTERM")
  } catch {}
  void removeDevPortStub()
  process.exit(code ?? 0)
})
