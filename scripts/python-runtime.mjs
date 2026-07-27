import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

function supportedVersion(command) {
  const probe = spawnSync(
    command,
    ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
    { encoding: "utf8" },
  )
  if (probe.status !== 0) return false
  const [major, minor] = probe.stdout.trim().split(".").map(Number)
  return major > 3 || (major === 3 && minor >= 12)
}

export function resolvePythonCommand(rootDir) {
  const virtualEnvironmentPython = process.platform === "win32"
    ? path.join(rootDir, ".venv", "Scripts", "python.exe")
    : path.join(rootDir, ".venv", "bin", "python")
  const candidates = [
    process.env.NOTEFLOW_PYTHON?.trim(),
    fs.existsSync(virtualEnvironmentPython) ? virtualEnvironmentPython : null,
    process.platform === "win32" ? "python" : "python3.12",
    "python3",
  ].filter(Boolean)

  for (const command of candidates) {
    if (supportedVersion(command)) return command
  }
  throw new Error(
    "NoteFlow requires Python 3.12+. Create .venv or set NOTEFLOW_PYTHON to a supported interpreter.",
  )
}
