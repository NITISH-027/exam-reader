/* Exam Reader - UI layer. All question text is rendered with textContent /
   createElement only; no user text ever passes through innerHTML. */
"use strict";
const Core = ExamReaderCore;
const byId = (id) => document.getElementById(id);

const OVERLAY_OPTIONS = Object.entries(Core.TINTS).map(([name, colour]) => [
  name,
  colour || "#ffffff",
]);
const store = Core.createSettingsStore(() => window.localStorage);
let settings = Core.mergeSettings(store.get());

/* ---------- small helpers ---------- */
function createElement(tag, cls, text) {
  const n = document.createElement(tag);
  if (tag === "button") n.type = "button";
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function announce(msg) {
  const lr = byId("live");
  if (lr) {
    lr.textContent = "";
    lr.textContent = msg;
  }
}
function debounce(fn, ms) {
  let t = null;
  return function (...a) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, a), ms);
  };
}

/* ---------- navigation ---------- */
let questions = [],
  wordElements = [],
  questionWords = [],
  currentQuestionIndex = 0,
  speaking = false,
  timer = null;
let highlightedWord = null,
  navigationIndices = [],
  speechSession = 0;
let cachedPaperText = null,
  cachedPaper = null;
const bookmarks = new Set();
const aiCache = new Map();
let aiRequestId = 0;
let aiController = null;

function go(name) {
  resetAiAid();
  document.body.classList.remove("spotdim");
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  byId("view-" + name).classList.remove("hidden");
  document.body.classList.toggle(
    "spotdim",
    name === "reader" && settings.spotlight,
  );
  byId("skipLink").href = "#main-" + name;
  window.scrollTo(0, 0);
  const main = document.querySelector("#view-" + name + " [data-main]");
  if (main) {
    main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
  }
}
document.querySelectorAll("[data-go]").forEach((b) =>
  b.addEventListener("click", (event) => {
    event.preventDefault();
    stopSpeak();
    go(b.dataset.go);
  }),
);

/* ---------- apply settings ---------- */
function apply() {
  document.body.dataset.contrast = settings.contrast;
  document.body.classList.remove(
    "sz0",
    "sz1",
    "sz2",
    "sz3",
    "sp0",
    "sp1",
    "sp2",
  );
  document.body.classList.add("sz" + settings.size, "sp" + settings.spacing);
  document.body.style.background = "";
  byId("qcard").style.background =
    settings.contrast === "none" ? Core.TINTS[settings.tint] || "" : "";
  byId("sizeLabel").textContent = Core.SIZE_STEPS[settings.size] + "%";
  document
    .querySelectorAll("#spacingSeg button")
    .forEach((b) =>
      b.classList.toggle("on", +b.dataset.sp === settings.spacing),
    );
  document
    .querySelectorAll("#contrastSeg button")
    .forEach((b) =>
      b.classList.toggle("on", b.dataset.c === settings.contrast),
    );
  document
    .querySelectorAll("#tints .sw")
    .forEach((b) =>
      b.classList.toggle("sel", b.dataset.tint === settings.tint),
    );
  document
    .querySelector('[data-rail="spotlight"]')
    .classList.toggle("on", settings.spotlight);
  document
    .querySelector('[data-rail="spotlight"]')
    .setAttribute("aria-pressed", String(settings.spotlight));
  byId("aloudSwitch").setAttribute(
    "aria-checked",
    settings.aloud ? "true" : "false",
  );
  byId("rulerBand").classList.toggle(
    "hidden",
    !settings.ruler || settings.spotlight,
  );
  document.querySelectorAll("#profileChips .pchip").forEach((b) => {
    b.classList.toggle("on", b.dataset.profile === settings.profile);
    b.setAttribute(
      "aria-pressed",
      b.dataset.profile === settings.profile ? "true" : "false",
    );
  });
  document
    .querySelectorAll("[data-sp],[data-c],#tints .sw")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(
          button.classList.contains("on") || button.classList.contains("sel"),
        ),
      ),
    );
  store.set(settings);
}

/* ---------- render reader (DOM-safe) ---------- */
function appendToken(span, token) {
  if (!settings.chunk) {
    span.appendChild(createElement("span", "w", token));
    return;
  }
  const t = Core.splitToken(token);
  if (!t || t.core.length < Core.CHUNK_MIN_LEN) {
    span.appendChild(createElement("span", "w", token));
    return;
  }
  const parts = Core.syllableChunks(t.core);
  if (parts.length < 2) {
    span.appendChild(createElement("span", "w", token));
    return;
  }
  const w = createElement("span", "w");
  w.appendChild(document.createTextNode(t.pre));
  parts.forEach((p, i) => {
    if (i) {
      const separator = createElement("span", "chunk", "·");
      separator.setAttribute("aria-hidden", "true");
      w.appendChild(separator);
    }
    w.appendChild(document.createTextNode(p));
  });
  w.appendChild(document.createTextNode(t.post));
  span.appendChild(w);
}

/** Build one question and cache speech token offsets. */
function appendQuestion(container, q, qi) {
  const div = createElement("div", "q" + (q.num ? "" : " intro"));
  div.dataset.q = qi;
  if (q.num) div.appendChild(createElement("span", "qn", "Q" + q.num));
  const marks = Core.extractMarks(q.text);
  if (marks) div.appendChild(createElement("span", "marks", marks + " marks"));
  const words = Core.stripMarks(q.text).split(/\s+/).filter(Boolean);
  const startIdx = wordElements.length;
  const span = createElement("span", "qt");
  words.forEach((w, i) => {
    if (i) span.appendChild(document.createTextNode(" "));
    appendToken(span, w);
  });
  div.appendChild(span);
  container.appendChild(div);
  const els = [...span.querySelectorAll(".w")];
  els.forEach((e) => wordElements.push(e));
  let characterOffset = 0;
  const offsets = words.map((word) => {
    const start = characterOffset;
    characterOffset += word.length + 1;
    return start;
  });
  questionWords.push({
    start: startIdx,
    count: els.length,
    text: words.join(" "),
    words,
    offsets,
  });
}

/** Build the paper with DOM nodes only. No pasted text becomes markup. */
function render() {
  stopSpeak();
  const paper = byId("paper");
  paper.textContent = "";
  wordElements = [];
  questionWords = [];
  paper.classList.toggle("listmode", !settings.spotlight);
  byId("qcard").classList.toggle("spot", settings.spotlight);
  const fragment = document.createDocumentFragment();
  questions.forEach((question, index) =>
    appendQuestion(fragment, question, index),
  );
  paper.appendChild(fragment);
  const numbered = questions
    .map((question, index) => (question.num ? index : -1))
    .filter((index) => index >= 0);
  navigationIndices = numbered.length
    ? numbered
    : questions.map((_, index) => index);
  updateSpot();
}

function navList() {
  return navigationIndices;
}

function updateSpot() {
  resetAiAid();
  const nav = navList();
  if (!nav.length) return;
  if (!nav.includes(currentQuestionIndex)) {
    const a = nav.find((n) => n > currentQuestionIndex);
    currentQuestionIndex = a != null ? a : nav[nav.length - 1];
  }
  document.querySelectorAll("#paper .q").forEach((elm) => {
    elm.style.display = settings.spotlight
      ? +elm.dataset.q === currentQuestionIndex
        ? ""
        : "none"
      : "";
  });
  document.body.classList.toggle(
    "spotdim",
    settings.spotlight && !byId("view-reader").classList.contains("hidden"),
  );
  const pos = nav.indexOf(currentQuestionIndex);
  byId("qPos").textContent = `Question ${pos + 1} of ${nav.length}`;
  const pct = Math.round(((pos + 1) / nav.length) * 100);
  byId("progressFill").style.width = pct + "%";
  byId("progressFill").parentElement.setAttribute("aria-valuenow", pct);
  byId("qPct").textContent = pct + "% complete";

  updateQuestionHeader();

  byId("prevQ").style.visibility = pos === 0 ? "hidden" : "visible";
  byId("nextQ").style.visibility =
    pos === nav.length - 1 ? "hidden" : "visible";
  announce(`Question ${pos + 1} of ${nav.length}`);
}

function updateQuestionHeader() {
  const q = questions[currentQuestionIndex];
  const top = byId("qcardTop");
  top.textContent = "";
  top.appendChild(createElement("span", "qchip", q.num ? "Q" + q.num : "Note"));
  const marks = Core.extractMarks(q.text);
  if (marks) top.appendChild(createElement("span", "mchip", marks + " Marks"));
  const acts = createElement("div", "qcard-acts");
  const bk = createElement(
    "button",
    bookmarks.has(currentQuestionIndex) ? "saved" : "",
    "★",
  );
  bk.id = "bkBtn";
  bk.title = "Bookmark";
  bk.setAttribute("aria-label", "Bookmark this question");
  bk.setAttribute(
    "aria-pressed",
    bookmarks.has(currentQuestionIndex) ? "true" : "false",
  );
  bk.addEventListener("click", () => {
    bookmarks.has(currentQuestionIndex)
      ? bookmarks.delete(currentQuestionIndex)
      : bookmarks.add(currentQuestionIndex);
    bk.classList.toggle("saved", bookmarks.has(currentQuestionIndex));
    bk.setAttribute(
      "aria-pressed",
      bookmarks.has(currentQuestionIndex) ? "true" : "false",
    );
    announce(
      bookmarks.has(currentQuestionIndex)
        ? "Question bookmarked"
        : "Bookmark removed",
    );
  });
  const fs = createElement("button", "", "⤢");
  fs.id = "fsBtn";
  fs.title = "Fullscreen";
  fs.setAttribute("aria-label", "Toggle fullscreen");
  fs.addEventListener("click", async () => {
    try {
      const card = byId("qcard");
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (card.requestFullscreen) await card.requestFullscreen();
      else announce("Fullscreen is not supported in this browser.");
    } catch (error) {
      announce(
        "Fullscreen is unavailable. You can still use every reading control.",
      );
    }
  });
  acts.appendChild(bk);
  acts.appendChild(fs);
  top.appendChild(acts);
}

function showQ(i, autoplay) {
  stopSpeak();
  currentQuestionIndex = i;
  updateSpot();
  document
    .querySelector('#paper .q:not([style*="none"])')
    ?.scrollIntoView({ behavior: motionBehavior(), block: "center" });
  if (autoplay && settings.aloud) speak();
}

/* ---------- read aloud ---------- */
function motionBehavior() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
function clearSaid() {
  if (highlightedWord) highlightedWord.classList.remove("said");
  highlightedWord = null;
}
function highlightWord(index) {
  clearSaid();
  highlightedWord = wordElements[index];
  if (!highlightedWord) return;
  highlightedWord.classList.add("said");
  highlightedWord.scrollIntoView({
    block: "center",
    behavior: motionBehavior(),
  });
}
/** Read-along remains available when no local speech voice is installed. */
function startFollowAlong() {
  byId("voiceNote").textContent =
    "No local voice available. Follow-along highlight is playing instead.";
  announce("Follow-along highlight playing.");
  let index = settings.spotlight
    ? questionWords[currentQuestionIndex].start
    : 0;
  const end = settings.spotlight
    ? questionWords[currentQuestionIndex].start +
      questionWords[currentQuestionIndex].count
    : wordElements.length;
  clearInterval(timer);
  timer = setInterval(() => {
    if (!speaking || index >= end) {
      stopSpeak();
      return;
    }
    highlightWord(index++);
  }, Core.CONFIG.highlightIntervalMs);
}
function speak() {
  if (!questionWords.length) return;
  if (speaking) {
    stopSpeak();
    return;
  }
  clearSaid();
  speaking = true;
  byId("playBtn").textContent = "⏸";
  byId("playBtn").setAttribute("aria-label", "Stop reading aloud");
  const session = ++speechSession;
  const seq = settings.spotlight
    ? [currentQuestionIndex]
    : questions.map((_, i) => i);
  const hasSynth = "speechSynthesis" in window;
  const voices = hasSynth
    ? speechSynthesis.getVoices().filter((voice) => voice.localService)
    : [];
  if (!hasSynth || !voices.length) {
    startFollowAlong();
    return;
  }
  byId("voiceNote").textContent = "";
  announce("Reading question aloud");
  let si = 0;
  const next = () => {
    if (!speaking || session !== speechSession) return;
    if (si >= seq.length) {
      stopSpeak();
      if (settings.aloud && settings.spotlight) {
        const nav = navList();
        const p = nav.indexOf(currentQuestionIndex);
        if (p < nav.length - 1) showQ(nav[p + 1], true);
      }
      return;
    }
    const qm = questionWords[seq[si]];
    const u = new SpeechSynthesisUtterance(qm.text);
    u.rate = Core.CONFIG.speechRate;
    u.voice = voices.find((voice) => /^en/i.test(voice.lang)) || voices[0];
    u.onboundary = (event) => {
      if (session !== speechSession || !speaking) return;
      const wordIndex = Core.wordIndexAt(qm.offsets, event.charIndex);
      if (wordIndex >= 0) highlightWord(qm.start + wordIndex);
    };
    u.onend = () => {
      if (session === speechSession) {
        si++;
        next();
      }
    };
    u.onerror = () => {
      if (session === speechSession && speaking) startFollowAlong();
    };
    speechSynthesis.speak(u);
  };
  next();
}
function stopSpeak() {
  speaking = false;
  speechSession++;
  clearInterval(timer);
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  byId("playBtn").textContent = "▶";
  byId("playBtn").setAttribute("aria-label", "Read question aloud");
  clearSaid();
}

/* ---------- paste screen ---------- */
const src = byId("src");
function updateInputState() {
  const error = src.value.trim() ? Core.validatePaper(src.value) : "";
  byId("inputError").textContent = error;
  byId("startBtn").disabled = Boolean(error);
  byId("charCount").textContent =
    src.value.length + " / " + Core.CONFIG.maxCharacters + " characters";
  document
    .querySelector(".paste-card")
    .classList.toggle("has-text", !!src.value.trim());
  byId("startBtn").classList.toggle("hidden", !src.value.trim());
}
const onSrcInput = debounce(updateInputState, Core.CONFIG.inputDebounceMs);
src.addEventListener("input", onSrcInput);
byId("sampleBtn").addEventListener("click", () => {
  src.value = Core.SAMPLE;
  updateInputState();
});
byId("clearBtn").addEventListener("click", () => {
  src.value = "";
  updateInputState();
  src.focus();
});
byId("startBtn").addEventListener("click", () => {
  const t = src.value.trim();
  if (!t) return;
  const error = Core.validatePaper(t);
  if (error) {
    byId("inputError").textContent = error;
    src.focus();
    return;
  }
  const paper = getPaperAnalysis(t);
  questions = paper.questions;
  bookmarks.clear();
  aiCache.clear();
  const stats = paper.stats;
  if (!questions.length) {
    byId("inputError").textContent = "Add text after the question number.";
    src.focus();
    return;
  }
  if (settings.profile && settings.profile !== "none") {
    const rec = Core.recommend(settings.profile, stats);
    settings = Object.assign(settings, rec.settings);
    showReasons(rec.reasons);
  } else {
    const tip = Core.paperTip(stats);
    if (tip) {
      showReasons([tip]);
      announce(tip);
    }
  }
  currentQuestionIndex = 0;
  render();
  apply();
  go("reader");
  if (settings.aloud) speak();
});

/* ---------- reading assistant ---------- */
/** Reuse parsing/statistics between profile previews and Start reading. */
function getPaperAnalysis(text) {
  if (cachedPaperText !== text) {
    const parsed = Core.parseQuestions(text);
    cachedPaper = { questions: parsed, stats: Core.paperStats(parsed) };
    cachedPaperText = text;
  }
  return cachedPaper;
}
function currentStats() {
  const text = src.value.trim();
  return text && !Core.validatePaper(text)
    ? getPaperAnalysis(text).stats
    : null;
}
function showReasons(reasons) {
  const note = byId("whyNote"),
    list = byId("whyList");
  list.textContent = "";
  if (!reasons || !reasons.length) {
    note.classList.add("hidden");
    return;
  }
  reasons.forEach((r) => list.appendChild(createElement("li", "", r)));
  note.classList.remove("hidden");
}
function selectProfile(key) {
  if (!Object.prototype.hasOwnProperty.call(Core.PROFILES, key)) return;
  settings.profile = key;
  byId("whyHead").textContent = "Selected: " + Core.PROFILES[key].label;
  document.querySelectorAll("#profileChips .pchip").forEach((b) => {
    b.classList.toggle("on", b.dataset.profile === key);
    b.setAttribute(
      "aria-pressed",
      b.dataset.profile === key ? "true" : "false",
    );
  });
  if (key === "none") {
    showReasons([
      "Manual settings selected. Your current settings are kept; you can change them below.",
    ]);
    announce("Manual settings selected.");
    apply();
    return;
  }
  const rec = Core.recommend(key, currentStats());
  settings = Object.assign(settings, rec.settings);
  byId("whyHead").textContent = "Selected: " + Core.PROFILES[key].label;
  apply();
  showReasons(rec.reasons);
  announce(
    Core.PROFILES[key].label +
      " profile applied. " +
      rec.reasons.length +
      " recommendations explained.",
  );
}
Object.keys(Core.PROFILES).forEach((k) => {
  const b = createElement("button", "pchip", Core.PROFILES[k].label);
  b.dataset.profile = k;
  b.setAttribute("aria-pressed", "false");
  b.addEventListener("click", () => selectProfile(k));
  byId("profileChips").appendChild(b);
});

/* ---------- shared controls ---------- */
document.querySelectorAll("[data-size]").forEach((b) =>
  b.addEventListener("click", () => {
    settings.size = Core.clampSize(settings.size, +b.dataset.size);
    apply();
    announce("Text size " + Core.SIZE_STEPS[settings.size] + " percent");
  }),
);
byId("spacingSeg")
  .querySelectorAll("button")
  .forEach((b) =>
    b.addEventListener("click", () => {
      settings.spacing = +b.dataset.sp;
      apply();
    }),
  );
byId("contrastSeg")
  .querySelectorAll("button")
  .forEach((b) =>
    b.addEventListener("click", () => {
      settings.contrast = b.dataset.c;
      apply();
      announce("Contrast mode changed");
    }),
  );
OVERLAY_OPTIONS.forEach(([k, c]) => {
  const d = createElement("button", "sw");
  d.dataset.tint = k;
  d.style.background = c;
  d.title = k || "none";
  d.setAttribute("aria-label", "Overlay " + (k || "none"));
  d.addEventListener("click", () => {
    settings.tint = k;
    apply();
  });
  byId("tints").appendChild(d);
});
byId("voiceTest").addEventListener("click", () => {
  const note =
    "This is how read aloud sounds. Every word lights up as it is spoken.";
  if (
    "speechSynthesis" in window &&
    speechSynthesis.getVoices().some((voice) => voice.localService)
  ) {
    const utterance = new SpeechSynthesisUtterance(note);
    utterance.voice = speechSynthesis
      .getVoices()
      .find((voice) => voice.localService);
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  } else {
    byId("voiceNote2").textContent =
      "No browser voice found on this device. In the reader, a follow-along highlight plays instead.";
  }
});

/* ---------- rail + popovers (built with DOM, no innerHTML) ---------- */
const pop = byId("pop");
let openPop = null;

function popHead(title) {
  pop.textContent = "";
  pop.appendChild(createElement("h4", "", title));
}

function buildSizePop() {
  popHead("Text size");
  const st = createElement("div", "stepper");
  const minus = createElement("button", "", "−");
  minus.setAttribute("aria-label", "Decrease text size");
  const plus = createElement("button", "", "+");
  plus.setAttribute("aria-label", "Increase text size");
  const lbl = createElement("span", "", Core.SIZE_STEPS[settings.size] + "%");
  minus.addEventListener("click", () => {
    settings.size = Core.clampSize(settings.size, -1);
    lbl.textContent = Core.SIZE_STEPS[settings.size] + "%";
    apply();
  });
  plus.addEventListener("click", () => {
    settings.size = Core.clampSize(settings.size, 1);
    lbl.textContent = Core.SIZE_STEPS[settings.size] + "%";
    apply();
  });
  st.appendChild(minus);
  st.appendChild(lbl);
  st.appendChild(plus);
  pop.appendChild(st);
}
function buildSegPop(title, values, labels, get, set, styles) {
  popHead(title);
  const seg = createElement("div", "seg");
  values.forEach((v, i) => {
    const b = createElement("button", get() === v ? "on" : "", labels[i]);
    b.setAttribute(
      "aria-label",
      title +
        ": " +
        (title === "Spacing"
          ? ["Normal", "Relaxed", "Wide"][i]
          : ["Normal", "Dark", "Yellow on black"][i]),
    );
    if (styles && styles[i]) {
      b.style.background = styles[i][0];
      b.style.color = styles[i][1];
    }
    b.setAttribute("aria-pressed", get() === v ? "true" : "false");
    b.addEventListener("click", () => {
      set(v);
      apply();
      seg.querySelectorAll("button").forEach((y, j) => {
        y.classList.toggle("on", values[j] === v);
        y.setAttribute("aria-pressed", values[j] === v ? "true" : "false");
      });
    });
    seg.appendChild(b);
  });
  pop.appendChild(seg);
}
function buildTintPop() {
  popHead("Colour overlay");
  const box = createElement("div", "swatches");
  OVERLAY_OPTIONS.forEach(([kk, c]) => {
    const d = createElement(
      "button",
      "sw" + (settings.tint === kk ? " sel" : ""),
    );
    d.style.background = c;
    d.title = kk || "none";
    d.setAttribute("aria-label", "Overlay " + (kk || "none"));
    d.addEventListener("click", () => {
      settings.tint = kk;
      apply();
      box.querySelectorAll(".sw").forEach((y) => y.classList.remove("sel"));
      d.classList.add("sel");
    });
    box.appendChild(d);
  });
  pop.appendChild(box);
}
function buildSettingsPop() {
  popHead("Settings");
  const mk = (label, get, set) => {
    const row = createElement("div", "rowline");
    row.appendChild(createElement("span", "", label));
    const sw = createElement("button", "switch");
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", get() ? "true" : "false");
    sw.setAttribute("aria-label", label);
    sw.appendChild(createElement("i"));
    sw.addEventListener("click", () => {
      set(!get());
      sw.setAttribute("aria-checked", get() ? "true" : "false");
      apply();
    });
    row.appendChild(sw);
    return row;
  };
  pop.appendChild(
    mk(
      "Chunk words",
      () => settings.chunk,
      (v) => {
        settings.chunk = v;
        render();
      },
    ),
  );
  pop.appendChild(
    mk(
      "Focus ruler (list view)",
      () => settings.ruler,
      (v) => {
        settings.ruler = v;
      },
    ),
  );
}
const POP_BUILDERS = {
  size: buildSizePop,
  spacing: () =>
    buildSegPop(
      "Spacing",
      [0, 1, 2],
      ["≡", "≣", "☰"],
      () => settings.spacing,
      (v) => {
        settings.spacing = v;
      },
    ),
  tint: buildTintPop,
  contrast: () =>
    buildSegPop(
      "Contrast",
      ["none", "dark", "yellow"],
      ["A", "A", "A"],
      () => settings.contrast,
      (v) => {
        settings.contrast = v;
      },
      [null, ["#17122b", "#fff"], ["#000", "#ffe600"]],
    ),
  settings: buildSettingsPop,
};

document.querySelectorAll(".rail-btn").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.rail;
    if (k === "spotlight") {
      settings.spotlight = !settings.spotlight;
      apply();
      render();
      hidePop();
      announce(
        settings.spotlight ? "Question spotlight on" : "Showing the full paper",
      );
      return;
    }
    if (k === "voice") {
      hidePop();
      speak();
      return;
    }
    if (openPop === k) {
      hidePop();
      return;
    }
    openPop = k;
    POP_BUILDERS[k]();
    pop.classList.remove("hidden");
    b.setAttribute("aria-expanded", "true");
    pop.querySelector("button")?.focus();
  }),
);
function hidePop(restoreFocus = false) {
  const opener = document.querySelector('[data-rail="' + openPop + '"]');
  if (opener) opener.setAttribute("aria-expanded", "false");
  openPop = null;
  pop.classList.add("hidden");
  if (restoreFocus) opener?.focus();
}
document.addEventListener("click", (e) => {
  if (openPop && !e.target.closest("#pop") && !e.target.closest(".rail-btn"))
    hidePop();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openPop) hidePop(true);
});

/* ---------- reader controls ---------- */
byId("playBtn").addEventListener("click", speak);
byId("aloudSwitch").addEventListener("click", () => {
  settings.aloud = !settings.aloud;
  apply();
  if (settings.aloud) speak();
  else stopSpeak();
});
const nextQFn = () => {
  const nav = navList();
  const p = nav.indexOf(currentQuestionIndex);
  if (p < nav.length - 1) showQ(nav[p + 1], true);
};
const prevQFn = () => {
  const nav = navList();
  const p = nav.indexOf(currentQuestionIndex);
  if (p > 0) showQ(nav[p - 1], true);
};
byId("nextQ").addEventListener("click", nextQFn);
byId("prevQ").addEventListener("click", prevQFn);
byId("nextQ2").addEventListener("click", nextQFn);
byId("prevQ2").addEventListener("click", prevQFn);
document.addEventListener("keydown", (e) => {
  if (byId("view-reader").classList.contains("hidden")) return;
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  if (
    e.altKey &&
    settings.ruler &&
    !settings.spotlight &&
    ["ArrowUp", "ArrowDown"].includes(e.key)
  ) {
    e.preventDefault();
    const band = byId("rulerBand");
    const limit = byId("qcard").offsetHeight - band.offsetHeight;
    const delta = e.key === "ArrowDown" ? 24 : -24;
    band.style.top =
      Math.max(0, Math.min(limit, (parseFloat(band.style.top) || 0) + delta)) +
      "px";
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    nextQFn();
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    prevQFn();
  }
});

/* ---------- focus ruler: schedule work only while the pointer moves ---------- */
let rulerFrame = null;
let rulerClientY = 0;
function drawRuler() {
  rulerFrame = null;
  if (!settings.ruler || settings.spotlight) return;
  const rectangle = byId("qcard").getBoundingClientRect();
  const band = byId("rulerBand");
  const top = rulerClientY - rectangle.top - band.offsetHeight / 2;
  band.style.top =
    Math.max(0, Math.min(rectangle.height - band.offsetHeight, top)) + "px";
}
byId("qcard").addEventListener("pointermove", (event) => {
  if (!settings.ruler || settings.spotlight) return;
  rulerClientY = event.clientY;
  if (rulerFrame === null) rulerFrame = requestAnimationFrame(drawRuler);
});
window.addEventListener("pagehide", stopSpeak);

if ("speechSynthesis" in window) speechSynthesis.getVoices();
if (settings.profile !== "none") {
  byId("whyHead").textContent =
    "Selected: " + Core.PROFILES[settings.profile].label;
  showReasons(Core.recommend(settings.profile, null).reasons);
}
apply();

/* ---------- explicit, optional Gemini reading aid ---------- */
function resetAiAid() {
  aiRequestId++;
  aiController?.abort();
  aiController = null;
  byId("aiConsent").checked = false;
  byId("simplifyBtn").disabled = true;
  byId("simplifyBtn").textContent = "Simplify with AI";
  byId("aiStatus").textContent = "";
  byId("aiResult").classList.add("hidden");
  byId("aiResultText").textContent = "";
}
function showAiAid(result) {
  byId("aiResultTitle").textContent =
    result.source === "gemini"
      ? "Gemini AI rewording, check against the original"
      : "Local reading guide, not an AI rewording";
  byId("aiResultText").textContent = result.text;
  byId("aiResult").classList.remove("hidden");
  const localReasons = {
    "not-configured": "Gemini is not configured on this server. ",
    busy: "The demo server is busy. ",
    timeout: "The AI response timed out. ",
    "provider-unavailable": "Gemini did not return a complete response. ",
  };

  byId("aiStatus").textContent =
    result.source === "gemini"
      ? "Original question and marks are unchanged. This aid may be inaccurate."
      : (localReasons[result.reason] || "") +
        "This is a local reading guide, not an AI rewording. Original question and marks are unchanged.";
}
byId("aiConsent").addEventListener("change", () => {
  byId("simplifyBtn").disabled = !byId("aiConsent").checked;
});
/** One explicit click, one question, one same-origin request. Never an automatic upload. */
byId("simplifyBtn").addEventListener("click", async () => {
  if (!byId("aiConsent").checked || !questions[currentQuestionIndex]) return;
  const question = questions[currentQuestionIndex].text;
  const profile = settings.profile;
  const key = JSON.stringify([question, profile]);
  const fallback = { source: "local", text: Core.localReadingAid(question) };
  const requestId = ++aiRequestId;
  const controller = new AbortController();
  aiController = controller;
  byId("simplifyBtn").disabled = true;
  byId("aiResult").classList.add("hidden");
  byId("aiStatus").textContent = "Preparing an optional reading aid...";
  let timeout;
  try {
    if (aiCache.has(key)) {
      showAiAid(aiCache.get(key));
      return;
    }
    if (
      !["http:", "https:"].includes(location.protocol) ||
      !navigator.onLine ||
      question.length > 6000
    ) {
      showAiAid(fallback);
      return;
    }
    timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch("/api/simplify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, profile }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (requestId !== aiRequestId) return;
    if (
      !["gemini", "local"].includes(result.source) ||
      typeof result.text !== "string" ||
      !result.text ||
      result.text.length > 8000
    ) {
      showAiAid(fallback);
      return;
    }
    if (result.source === "gemini") {
      if (aiCache.size >= 50) aiCache.delete(aiCache.keys().next().value);
      aiCache.set(key, result);
    }
    showAiAid(result);
  } catch (error) {
    if (requestId === aiRequestId) showAiAid(fallback);
  } finally {
    clearTimeout(timeout);
    if (requestId === aiRequestId) {
      byId("simplifyBtn").disabled = !byId("aiConsent").checked;
      aiController = null;
    }
  }
});

byId("localAidBtn").addEventListener("click", () => {
  if (!questions[currentQuestionIndex]) return;
  aiRequestId++;
  aiController?.abort();
  aiController = null;
  byId("simplifyBtn").disabled = !byId("aiConsent").checked;
  showAiAid({
    source: "local",
    text: Core.localReadingAid(questions[currentQuestionIndex].text),
  });
});
