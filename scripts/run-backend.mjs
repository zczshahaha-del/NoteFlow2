#!/usr/bin/env node

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolvePythonCommand } from "./python-runtime.mjs"

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const serverDir = path.join(rootDir, "server")

let pythonCommand
try {
  pythonCommand = resolvePythonCommand(rootDir)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const backend = spawn(pythonCommand, ["-m", "app.main"], {
  cwd: serverDir,
  stdio: "inherit",
  env: process.env,
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => backend.kill(signal))
}

backend.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
