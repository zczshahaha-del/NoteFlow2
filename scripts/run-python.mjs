#!/usr/bin/env node

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolvePythonCommand } from "./python-runtime.mjs"

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)

if (args.length === 0) {
  console.error("run-python.mjs requires a Python module or script argument.")
  process.exit(2)
}

let pythonCommand
try {
  pythonCommand = resolvePythonCommand(rootDir)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const existingPythonPath = process.env.PYTHONPATH?.trim()
const pythonPath = existingPythonPath
  ? `${path.join(rootDir, "server")}${path.delimiter}${existingPythonPath}`
  : path.join(rootDir, "server")
const child = spawn(pythonCommand, args, {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHONPATH: pythonPath,
  },
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
