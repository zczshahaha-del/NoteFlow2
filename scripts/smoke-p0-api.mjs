const baseUrl = process.env.NOTEFLOW_API_URL || "http://127.0.0.1:8080";
const email = process.env.NOTEFLOW_TEST_EMAIL;
const password = process.env.NOTEFLOW_TEST_PASSWORD;
const query = process.env.NOTEFLOW_TEST_QUERY || "星河缓存探针";

if (!email || !password) {
  throw new Error("NOTEFLOW_TEST_EMAIL and NOTEFLOW_TEST_PASSWORD are required");
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path} returned non-JSON content`);
  }
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${data.detail || response.statusText}`);
  }
  return data;
}

const session = await jsonRequest("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const headers = {
  Authorization: `Bearer ${session.token}`,
  "Content-Type": "application/json",
};

const fixtureId = `p0-smoke-${Date.now()}`;
let fixtureCreated = false;

try {
  await jsonRequest("/api/notes", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: fixtureId,
      title: `${query} · P0 搜索与版本测试`,
      content: `# 搜索测试\n\n${query} 用于验证正文、小节与语义检索。`,
      tags: ["smoke-test"],
    }),
  });
  fixtureCreated = true;

  await jsonRequest(`/api/notes/${encodeURIComponent(fixtureId)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      content: `# 搜索测试\n\n${query} 用于验证正文、小节与语义检索。\n\n第二版内容。`,
      source: "manual_edit",
      changeSummary: "P0 smoke test version",
    }),
  });

  const searchData = await jsonRequest("/api/notes/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, limit: 12 }),
  });
  if (!searchData.query || !Array.isArray(searchData.results)) {
    throw new Error("search response is invalid");
  }
  if (!searchData.results.some((item) => item.noteId === fixtureId)) {
    throw new Error("search did not return the indexed fixture note");
  }

  const versionsData = await jsonRequest(
    `/api/notes/${encodeURIComponent(fixtureId)}/versions`,
    { headers }
  );
  if (!Array.isArray(versionsData.versions) || versionsData.versions.length === 0) {
    throw new Error("version history did not return the saved fixture version");
  }

  const restoredData = await jsonRequest(
    `/api/notes/${encodeURIComponent(fixtureId)}/versions/${encodeURIComponent(versionsData.versions[0].id)}/restore`,
    { method: "POST", headers }
  );
  if (!restoredData.note?.content?.includes(query) || restoredData.note.content.includes("第二版内容")) {
    throw new Error("version restore did not restore the expected content");
  }

  console.log(JSON.stringify({
    ok: true,
    searchResultCount: searchData.results.length,
    searchChannels: [...new Set(searchData.results.flatMap((item) => item.retrievalChannels || [item.sourceType]))],
    versionCount: versionsData.versions.length,
    restoreVerified: true,
    fixtureCleaned: true,
  }));
} finally {
  if (fixtureCreated) {
    await jsonRequest(`/api/notes/${encodeURIComponent(fixtureId)}`, {
      method: "DELETE",
      headers,
    }).catch(() => null);
  }
}
