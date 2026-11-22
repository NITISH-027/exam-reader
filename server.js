"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  AI_LIMITS,
  createRateLimiter,
  createSimplifier,
} = require("./ai-service.js");

const ASSETS = Object.freeze({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/core.js": ["core.js", "application/javascript; charset=utf-8"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8"],
  "/reader-view.js": [
    "reader-view.js",
    "application/javascript; charset=utf-8",
  ],
  "/ai-aid.js": ["ai-aid.js", "application/javascript; charset=utf-8"],
  "/speech-controller.js": [
    "speech-controller.js",
    "application/javascript; charset=utf-8",
  ],
});
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function securityHeaders(response) {
  response.setHeader("Content-Security-Policy", CSP);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.setHeader("Cache-Control", "no-store");
}
function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

/** Host/Origin agreement protects browser callers; it is not authentication. */
function sameOrigin(request) {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  if (!request.headers.origin) return true;
  try {
    return new URL(request.headers.origin).host === request.headers.host;
  } catch {
    return false;
  }
}

/** Stream and cap JSON input before parsing. No request body is logged. */
async function readJson(request) {
  const length = Number(request.headers["content-length"] || 0);
  if (!Number.isFinite(length) || length > AI_LIMITS.requestBytes)
    throw new RangeError("body-limit");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > AI_LIMITS.requestBytes) throw new RangeError("body-limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Validate one API request; route-level error handling stays in createApp. */
async function handleSimplifyRequest(request, response, simplify, limiter) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Use POST." });
  }
  if (!sameOrigin(request))
    return sendJson(response, 403, {
      error: "Same-origin requests only.",
    });
  if (
    !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")
  )
    return sendJson(response, 415, { error: "Use application/json." });
  // Use the socket address, not a caller-controlled forwarded-IP header.
  // On Cloud Run a shared proxy may make this stricter; global caps also apply.
  if (!limiter.allow(request.socket.remoteAddress || "unknown")) {
    response.setHeader("Retry-After", "60");
    return sendJson(response, 429, {
      error: "Too many requests. Use the local reading controls and try later.",
    });
  }
  const payload = await readJson(request);
  const result = await simplify(payload);
  return sendJson(response, result.status, result.body);
}

/** Build an HTTP server with an injected AI implementation for integration tests. */
function createApp({
  simplify = createSimplifier({
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  }),
  limiter = createRateLimiter(),
} = {}) {
  const assetCache = new Map();
  const server = http.createServer(async (request, response) => {
    securityHeaders(response);
    const route = (request.url || "/").split("?")[0];
    try {
      if (route === "/api/simplify")
        return await handleSimplifyRequest(
          request,
          response,
          simplify,
          limiter,
        );
      if (request.method !== "GET" && request.method !== "HEAD")
        return sendJson(response, 405, { error: "Method not allowed." });
      if (route === "/healthz")
        return sendJson(response, 200, { status: "ok" });
      const asset = ASSETS[route];
      if (!asset) return sendJson(response, 404, { error: "Not found." });
      if (!assetCache.has(asset[0]))
        assetCache.set(
          asset[0],
          await fs.readFile(path.join(__dirname, asset[0])),
        );
      const content = assetCache.get(asset[0]);
      response.writeHead(200, { "Content-Type": asset[1] });
      return response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error instanceof RangeError)
        return sendJson(response, 413, { error: "Request is too large." });
      if (error instanceof SyntaxError)
        return sendJson(response, 400, { error: "Invalid JSON." });
      return sendJson(response, 500, {
        error: "Request unavailable. Local reading controls still work.",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createApp().listen(port, "0.0.0.0", () =>
    console.log("Exam Reader server is ready."),
  );
}
module.exports = { createApp, sameOrigin, CSP };
