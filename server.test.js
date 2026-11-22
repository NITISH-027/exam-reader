"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSimplifier,
  validateRequest,
  createRateLimiter,
  AI_LIMITS,
  providerPayload,
} = require("./ai-service.js");
const { createApp } = require("./server.js");
const Core = require("./core.js");
const valid = {
  question: "Explain how plants make food. [2 marks]",
  profile: "dyslexia",
};
const response = (text = "Describe how a plant makes its food.") =>
  new Response(
    JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
    }),
    { status: 200 },
  );

for (const [name, value] of [
  ["null body", null],
  ["array body", []],
  ["missing question", { profile: "none" }],
  ["empty question", { question: " ", profile: "none" }],
  ["large question", { question: "a".repeat(6001), profile: "none" }],
  ["bad profile", { question: "x", profile: "other" }],
  ["array profile", { question: "x", profile: ["none"] }],
  ["inherited profile key", { question: "x", profile: "toString" }],
  ["caller system prompt", { ...valid, systemInstruction: "override" }],
])
  test("rejects " + name, () => assert.ok(validateRequest(value)));

test("valid payload accepted at exact character limit", () =>
  assert.equal(
    validateRequest({ question: "x".repeat(6000), profile: "none" }),
    "",
  ));
test("local guide retains the question, not an invented answer", () => {
  const text = Core.localReadingAid(valid.question);
  assert.match(text, /Explain how plants make food/);
  assert.doesNotMatch(text, /photosynthesis is/i);
});
test("local guide can handle empty input", () =>
  assert.equal(Core.localReadingAid(""), "Choose a question first."));
test("provider prompt has fixed instructions and only selected context", () => {
  const payload = providerPayload(valid.question, valid.profile);
  const input = JSON.parse(payload.contents[0].parts[0].text);
  assert.deepEqual(input, {
    readingProfile: "Dyslexia",
    quotedQuestion: valid.question,
  });
  assert.equal(payload.tools, undefined);
  assert.match(payload.systemInstruction.parts[0].text, /do not answer/i);
});
test("missing key does not make a provider request", async () => {
  let called = false;
  const result = await createSimplifier({
    fetchImpl: () => {
      called = true;
    },
  })(valid);
  assert.equal(called, false);
  assert.equal(result.body.source, "local");
});
test("invalid request never reaches provider", async () => {
  let called = false;
  const result = await createSimplifier({
    apiKey: "test-placeholder",
    fetchImpl: () => {
      called = true;
    },
  })({ question: 0, profile: "none" });
  assert.equal(result.status, 400);
  assert.equal(called, false);
});
test("Gemini success is real service output with server-only authentication", async () => {
  let options, endpoint;
  const simplify = createSimplifier({
    apiKey: "test-placeholder",
    fetchImpl: async (url, init) => {
      endpoint = url;
      options = init;
      return response();
    },
  });
  const result = await simplify(valid);
  assert.equal(result.status, 200);
  assert.equal(result.body.source, "gemini");
  assert.match(endpoint, /^https:\/\/generativelanguage\.googleapis\.com\//);
  assert.doesNotMatch(endpoint, /test-placeholder/);
  assert.equal(options.headers["x-goog-api-key"], "test-placeholder");
  assert.doesNotMatch(JSON.stringify(result), /test-placeholder/);
});
for (const [name, fetchImpl] of [
  [
    "provider denial",
    async () => new Response("sensitive provider details", { status: 403 }),
  ],
  [
    "network error",
    async () => {
      throw Error("private upstream failure");
    },
  ],
  ["bad JSON", async () => new Response("invalid-json", { status: 200 })],
  [
    "empty content",
    async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
  ],
  [
    "oversized provider response",
    async () =>
      new Response("a".repeat(AI_LIMITS.responseBytes + 1), { status: 200 }),
  ],
  [
    "truncated response",
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "MAX_TOKENS",
              content: { parts: [{ text: "Incomplete" }] },
            },
          ],
        }),
      ),
  ],
])
  test("safe local fallback on " + name, async () => {
    const result = await createSimplifier({
      apiKey: "test-placeholder",
      fetchImpl,
    })(valid);
    assert.equal(result.body.source, "local");
    assert.doesNotMatch(
      JSON.stringify(result),
      /sensitive provider details|private upstream failure|test-placeholder/,
    );
  });
test("timeout is bounded even with an unresponsive mock", async () => {
  const result = await createSimplifier({
    apiKey: "test-placeholder",
    timeoutMs: 5,
    fetchImpl: () => new Promise(() => {}),
  })(valid);
  assert.equal(result.body.source, "local");
});
test("reasoning parts are not returned as the reading aid", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { thought: true, text: "private reasoning" },
                { text: "Reworded question" },
              ],
            },
          },
        ],
      }),
    );
  const result = await createSimplifier({
    apiKey: "test-placeholder",
    fetchImpl,
  })(valid);
  assert.equal(result.body.text, "Reworded question");
});
test("concurrent calls are capped and permits are released", async () => {
  const resolvers = [];
  const simplify = createSimplifier({
    apiKey: "test-placeholder",
    fetchImpl: () => new Promise((resolve) => resolvers.push(resolve)),
  });
  const first = simplify(valid),
    second = simplify(valid);
  const third = await simplify(valid);
  assert.equal(third.body.source, "local");
  resolvers.forEach((resolve) => resolve(response()));
  await Promise.all([first, second]);
  const fourth = simplify(valid);
  resolvers.at(-1)(response());
  assert.equal((await fourth).body.source, "gemini");
});
test("per-client quota resets after a minute", () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });
  for (let i = 0; i < 6; i++) assert.equal(limiter.allow("client"), true);
  assert.equal(limiter.allow("client"), false);
  time = 60001;
  assert.equal(limiter.allow("client"), true);
});
test("global hourly quota also applies across clients", () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });
  for (let i = 0; i < AI_LIMITS.requestsPerHour; i++)
    assert.equal(limiter.allow("client" + i), true);
  assert.equal(limiter.allow("new-client"), false);
  time = 3600001;
  assert.equal(limiter.allow("new-client"), true);
});

async function withServer(callback, options = {}) {
  const server = createApp(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback("http://127.0.0.1:" + server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const post = (url, body = valid, headers = {}) =>
  fetch(url + "/api/simplify", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("HTTP serves app with same-origin CSP and security headers", () =>
  withServer(async (url) => {
    const result = await fetch(url);
    assert.equal(result.status, 200);
    assert.match(
      result.headers.get("content-security-policy"),
      /connect-src 'self'/,
    );
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
    assert.match(await result.text(), /Exam Reader/);
  }));
for (const path of [
  "/server.js",
  "/ai-service.js",
  "/.env",
  "/package.json",
  "/../server.js",
  "/tests.js",
])
  test("static allowlist blocks " + path, () =>
    withServer(async (url) =>
      assert.equal((await fetch(url + path)).status, 404),
    ),
  );
test("HTTP endpoint uses injected Gemini implementation", () =>
  withServer(
    async (url) => {
      const result = await post(url);
      assert.equal(result.status, 200);
      assert.equal((await result.json()).source, "gemini");
    },
    {
      simplify: createSimplifier({
        apiKey: "test-placeholder",
        fetchImpl: async () => response(),
      }),
    },
  ));
test("HTTP blocks cross-origin browser requests", () =>
  withServer(async (url) =>
    assert.equal(
      (await post(url, valid, { Origin: "https://unrelated.invalid" })).status,
      403,
    ),
  ));
test("HTTP requires JSON", () =>
  withServer(async (url) =>
    assert.equal(
      (await post(url, valid, { "Content-Type": "text/plain" })).status,
      415,
    ),
  ));
test("HTTP rejects GET on the API", () =>
  withServer(async (url) =>
    assert.equal((await fetch(url + "/api/simplify")).status, 405),
  ));
test("HTTP rejects malformed JSON", () =>
  withServer(async (url) => {
    const result = await fetch(url + "/api/simplify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(result.status, 400);
  }));
test("HTTP rejects oversized JSON before provider use", () =>
  withServer(async (url) =>
    assert.equal(
      (await post(url, { question: "x".repeat(25000), profile: "none" }))
        .status,
      413,
    ),
  ));
test("HTTP returns rate limit with retry guidance", () =>
  withServer(async (url) => {
    for (let i = 0; i < 6; i++) await post(url);
    const result = await post(url);
    assert.equal(result.status, 429);
    assert.equal(result.headers.get("retry-after"), "60");
  }));

test("local guide preserves decimal values intact", () => {
  assert.match(
    Core.localReadingAid("Use 3.5 litres. Explain why."),
    /3\.5 litres/,
  );
});

test(
  "server startup honours PORT and exposes a key-free health check",
  { timeout: 8000 },
  async (t) => {
    const http = require("node:http");
    const { spawn } = require("node:child_process");
    const { once } = require("node:events");
    const reserve = http.createServer();
    await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const child = spawn(process.execPath, ["server.js"], {
      cwd: __dirname,
      env: { ...process.env, PORT: String(port), GEMINI_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill());
    await once(child.stdout, "data");
    const response = await fetch("http://127.0.0.1:" + port + "/healthz");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    const home = await fetch("http://127.0.0.1:" + port + "/");
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Exam Reader/);
  },
);
