import assert from "node:assert/strict";
import fs from "node:fs";

function pngSize(path) {
  const bytes = fs.readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
assert.equal(manifest.name, "知流 NoteFlow");
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.lang, "zh-CN");

const icons = new Map(manifest.icons.map((icon) => [icon.sizes, icon]));
assert.equal(icons.get("192x192")?.type, "image/png");
assert.equal(icons.get("512x512")?.type, "image/png");
assert.deepEqual(pngSize("public/pwa-192.png"), { width: 192, height: 192 });
assert.deepEqual(pngSize("public/pwa-512.png"), { width: 512, height: 512 });
assert.deepEqual(pngSize("public/apple-touch-icon.png"), { width: 180, height: 180 });

const indexHtml = fs.readFileSync("index.html", "utf8");
assert.match(indexHtml, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(indexHtml, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
assert.match(indexHtml, /name="theme-color"/);

const serviceWorker = fs.readFileSync("public/sw.js", "utf8");
for (const asset of ["/manifest.webmanifest", "/pwa-192.png", "/pwa-512.png", "/apple-touch-icon.png"]) {
  assert.ok(serviceWorker.includes(asset), `service worker shell misses ${asset}`);
}
assert.match(serviceWorker, /request\.mode === "navigate"/);
assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);

console.log(JSON.stringify({
  ok: true,
  display: manifest.display,
  icons: [pngSize("public/pwa-192.png"), pngSize("public/pwa-512.png")],
  offlineShellAssets: true,
}));
