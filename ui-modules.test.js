"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("./core.js");
const { createApp } = require("./server.js");

function controls() {
  const elements = new Map();
  return (id) => {
    if (!elements.has(id)) {
      const classes = new Set(["hidden"]);
      elements.set(id, {
        checked: false,
        disabled: true,
        textContent: "",
        handlers: {},
        addEventListener(name, handler) {
          this.handlers[name] = handler;
        },
        setAttribute(name, value) {
          this[name] = value;
        },
        scrollIntoView() {},
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
        },
      });
    }
    return elements.get(id);
  };
}
function loadModule(file, environment = {}) {
  const scope = {
    module: { exports: {} },
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...environment,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, file), "utf8"),
    scope,
  );
  return scope.module.exports;
}
function aiFixture(fetchImpl) {
  const byId = controls();
  const state = {
    questions: [{ text: "First question?" }, { text: "Second question?" }],
    currentQuestionIndex: 0,
    settings: { profile: "none" },
  };
  const api = loadModule("ai-aid.js", {
    location: { protocol: "http:" },
    navigator: { onLine: true },
    fetch: fetchImpl,
  });
  const controller = api.create({ Core, byId, getState: () => state });
  return {
    byId,
    state,
    controller,
    click: () => byId("simplifyBtn").handlers.click(),
  };
}

test("AI controller sends nothing without explicit consent", async () => {
  let calls = 0;
  const f = aiFixture(async () => {
    calls++;
  });
  await f.click();
  f.byId("aiConsent").checked = true;
  f.byId("aiConsent").handlers.change();
  assert.equal(calls, 0);
  assert.equal(f.byId("simplifyBtn").disabled, false);
});
test("AI controller reads current question/profile and caches by both", async () => {
  const payloads = [];
  const f = aiFixture(async (_, request) => {
    payloads.push(JSON.parse(request.body));
    return { json: async () => ({ source: "gemini", text: "Rewording" }) };
  });
  f.byId("aiConsent").checked = true;
  await f.click();
  await f.click();
  assert.equal(payloads.length, 1);
  f.state.settings.profile = "focus";
  f.state.currentQuestionIndex = 1;
  await f.click();
  assert.deepEqual(payloads[1], {
    question: "Second question?",
    profile: "focus",
  });
  f.controller.clearCache();
  await f.click();
  assert.equal(payloads.length, 3);
});
test("reset aborts pending AI and ignores its late successful response", async () => {
  let release, signal;
  const f = aiFixture(async (_, request) => {
    signal = request.signal;
    return {
      json: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
  });
  f.byId("aiConsent").checked = true;
  const pending = f.click();
  await new Promise(setImmediate);
  f.controller.reset();
  assert.equal(signal.aborted, true);
  release({ source: "gemini", text: "Stale response" });
  await pending;
  assert.equal(f.byId("aiResult").classList.contains("hidden"), true);
  assert.equal(f.byId("aiResultText").textContent, "");
  assert.equal(f.byId("aiConsent").checked, false);
});
test("local guide cancels AI and cannot be replaced by a late response", async () => {
  let release;
  const f = aiFixture(async () => ({
    json: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  }));
  f.byId("aiConsent").checked = true;
  const pending = f.click();
  await new Promise(setImmediate);
  f.byId("localAidBtn").handlers.click();
  const localText = f.byId("aiResultText").textContent;
  release({ source: "gemini", text: "Stale" });
  await pending;
  assert.equal(f.byId("aiResultText").textContent, localText);
  assert.match(localText, /First question/);
});
test("invalid AI output and network errors retain local fallback", async () => {
  for (const value of [
    null,
    { source: "unknown", text: "Wrong" },
    { source: "gemini", text: "" },
    { source: "gemini", text: "x".repeat(8001) },
  ]) {
    const f = aiFixture(async () => ({ json: async () => value }));
    f.byId("aiConsent").checked = true;
    await f.click();
    assert.match(f.byId("aiResultTitle").textContent, /Local reading guide/);
  }
  const f = aiFixture(async () => {
    throw new Error("network");
  });
  f.byId("aiConsent").checked = true;
  await f.click();
  assert.match(f.byId("aiResultTitle").textContent, /Local reading guide/);
});

function speechFixture(voices) {
  const byId = controls();
  const utterances = [],
    navigation = [];
  const synth = {
    getVoices: () => voices,
    speak: (utterance) => utterances.push(utterance),
    cancel() {},
  };
  const state = {
    settings: { spotlight: true, aloud: true },
    questions: [{}, {}],
    currentQuestionIndex: 0,
    wordElements: [byId("word0"), byId("word1")],
    questionWords: [
      { start: 0, count: 1, offsets: [0], text: "First" },
      { start: 1, count: 1, offsets: [0], text: "Second" },
    ],
  };
  let interval;
  const api = loadModule("speech-controller.js", {
    window: { speechSynthesis: synth },
    speechSynthesis: synth,
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text;
      }
    },
    setInterval: (callback) => {
      interval = callback;
      return 1;
    },
    clearInterval() {},
  });
  const controller = api.create({
    Core,
    byId,
    announce() {},
    getState: () => state,
    getNavigation: () => [0, 1],
    navigate: (...args) => navigation.push(args),
    motionBehavior: () => "auto",
  });
  return {
    controller,
    byId,
    utterances,
    navigation,
    state,
    tick: () => interval(),
  };
}
test("speech selects a local English voice and highlights cached offsets", () => {
  const local = { localService: true, lang: "en-IN" };
  const f = speechFixture([{ localService: false, lang: "en-US" }, local]);
  f.controller.toggle();
  assert.equal(f.utterances.length, 1);
  assert.equal(f.utterances[0].voice, local);
  assert.equal(f.utterances[0].rate, Core.CONFIG.speechRate);
  f.utterances[0].onboundary({ charIndex: 0 });
  assert.equal(f.byId("word0").classList.contains("said"), true);
  f.controller.stop();
  assert.equal(f.byId("word0").classList.contains("said"), false);
});
test("stale speech callbacks cannot highlight or navigate after stop", () => {
  const f = speechFixture([{ localService: true, lang: "en" }]);
  f.controller.toggle();
  const old = f.utterances[0];
  f.controller.stop();
  old.onboundary({ charIndex: 0 });
  old.onend();
  old.onerror();
  assert.equal(f.byId("word0").classList.contains("said"), false);
  assert.equal(f.navigation.length, 0);
  assert.equal(f.utterances.length, 1);
});
test("speech completion uses current navigation state for continuous reading", () => {
  const f = speechFixture([{ localService: true, lang: "en" }]);
  f.controller.toggle();
  f.utterances[0].onend();
  assert.deepEqual(f.navigation, [[1, true]]);
});
test("no-local-voice path highlights locally and stops at question end", () => {
  const f = speechFixture([{ localService: false, lang: "en" }]);
  f.controller.toggle();
  f.tick();
  assert.equal(f.utterances.length, 0);
  assert.equal(f.byId("word0").classList.contains("said"), true);
  f.tick();
  assert.equal(f.byId("word0").classList.contains("said"), false);
  assert.match(f.byId("voiceNote").textContent, /Follow-along/);
});
test("new browser modules are allowlisted, served intact and shipped by Docker", async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const file of [
      "reader-view.js",
      "ai-aid.js",
      "speech-controller.js",
    ]) {
      const url = `http://127.0.0.1:${server.address().port}/${file}`;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(
        await response.text(),
        fs.readFileSync(path.join(__dirname, file), "utf8"),
      );
      assert.match(
        response.headers.get("content-security-policy"),
        /script-src 'self'/,
      );
      assert.equal(await (await fetch(url, { method: "HEAD" })).text(), "");
      for (const config of [
        "Dockerfile",
        ".dockerignore",
        "index.html",
        "package.json",
      ]) {
        assert.ok(
          fs.readFileSync(path.join(__dirname, config), "utf8").includes(file),
          `${config} includes ${file}`,
        );
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
