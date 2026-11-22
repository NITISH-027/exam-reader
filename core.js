/* Exam Reader - DOM-independent logic and injected preference storage.
   Shared by the browser app (app.js) and the automated tests (tests.js). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExamReaderCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Resource bounds and rule thresholds, shared by the UI and tests. */
  var CONFIG = Object.freeze({
    maxCharacters: 50000,
    maxWords: 8000,
    longWordLength: 7,
    heavyVocabularyRatio: 0.12,
    denseQuestionWords: 25,
    inputDebounceMs: 80,
    highlightIntervalMs: 320,
    speechRate: 0.92,
    storageKey: "examreader",
  });

  /* ---------- settings ---------- */
  var DEFAULT_SETTINGS = Object.freeze({
    size: 0, // 0..3 -> 100% 115% 130% 150%
    spacing: 0, // 0 normal, 1 relaxed, 2 wide
    tint: "", // '' | cream | mint | blue | rose
    contrast: "none", // none | dark | yellow
    spotlight: true,
    chunk: false,
    ruler: false,
    aloud: false,
    profile: "none", // none | dyslexia | lowvision | focus | esl | time
  });
  var SIZE_STEPS = [100, 115, 130, 150];
  var TINTS = {
    "": "",
    cream: "#fdf6e3",
    blue: "#e8f1f8",
    mint: "#eef7ee",
    rose: "#fdf0ee",
  };

  function clampSize(size, delta) {
    return Math.max(0, Math.min(SIZE_STEPS.length - 1, size + delta));
  }
  /** Restore only known keys whose values belong to the settings schema. */
  function mergeSettings(saved) {
    var result = Object.assign({}, DEFAULT_SETTINGS);
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return result;
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(saved, key)) return;
      var value = saved[key];
      if (
        key === "size" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value < SIZE_STEPS.length
      )
        result[key] = value;
      else if (
        key === "spacing" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 2
      )
        result[key] = value;
      else if (
        key === "tint" &&
        typeof value === "string" &&
        Object.prototype.hasOwnProperty.call(TINTS, value)
      )
        result[key] = value;
      else if (key === "contrast" && ["none", "dark", "yellow"].includes(value))
        result[key] = value;
      else if (
        key === "profile" &&
        typeof value === "string" &&
        Object.prototype.hasOwnProperty.call(PROFILES, value)
      )
        result[key] = value;
      else if (
        typeof DEFAULT_SETTINGS[key] === "boolean" &&
        typeof value === "boolean"
      )
        result[key] = value;
    });
    return result;
  }

  /** Guard both browser entry and direct use. Never silently truncate a paper. */
  function validatePaper(text) {
    if (typeof text !== "string" || !text.trim())
      return "Paste some question text first.";
    if (text.length > CONFIG.maxCharacters)
      return "Paper limit: 50,000 characters. Please paste a smaller section.";
    if (text.trim().split(/\s+/).length > CONFIG.maxWords)
      return "Paper limit: 8,000 words. Please paste a smaller section.";
    return "";
  }

  /** A storage adapter with injected storage for tests. Never stores paper text. */
  function createSettingsStore(getStorage) {
    return {
      get: function () {
        try {
          var raw = getStorage().getItem(CONFIG.storageKey);
          if (!raw || raw.length > 2048) return mergeSettings(null);
          return mergeSettings(JSON.parse(raw));
        } catch (error) {
          return mergeSettings(null);
        }
      },
      set: function (settings) {
        try {
          getStorage().setItem(
            CONFIG.storageKey,
            JSON.stringify(mergeSettings(settings)),
          );
        } catch (error) {
          /* Private mode or full storage must not block reading. */
        }
      },
    };
  }

  /** Binary search over cached token start offsets for speech boundary events. */
  function wordIndexAt(offsets, characterIndex) {
    var low = 0,
      high = offsets.length - 1,
      found = -1;
    while (low <= high) {
      var middle = (low + high) >>> 1;
      if (offsets[middle] <= characterIndex) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found;
  }

  /* ---------- question parsing ---------- */
  // Accepts "1.", "1)", "Q2:", "Question 3 -" at the start of a line.
  var Q_RE = /^\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[\.\)\:\-]\s*/i;
  var MARKS_RE = /[\[\(](\d+)\s*marks?[\]\)]/i;

  /** Parse numbered lines into ordered blocks; preserve content as plain text. */
  function parseQuestions(text) {
    if (text == null || !String(text).trim()) return [];
    text = String(text);
    var error = validatePaper(text);
    if (error) throw new RangeError(error);
    var blocks = [];
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln) continue;
      var m = ln.match(Q_RE);
      if (m) blocks.push({ num: m[1], text: ln.replace(Q_RE, "").trim() });
      else if (blocks.length === 0) blocks.push({ num: "", text: ln });
      else blocks[blocks.length - 1].text += " " + ln;
    }
    return blocks.filter(function (b) {
      return b.text.trim().length > 0;
    });
  }

  /** Read the first explicit marks annotation without evaluating any markup. */
  function extractMarks(text) {
    var m = String(text || "").match(MARKS_RE);
    return m ? m[1] : null;
  }
  /** Remove only the marks annotation displayed separately as a badge. */
  function stripMarks(text) {
    return String(text || "").replace(MARKS_RE, "");
  }

  /* ---------- syllable chunker ---------- */
  var CHUNK_EXC = {
    process: "pro-cess",
    sunlight: "sun-light",
    sentence: "sen-tence",
    sentences: "sen-tenc-es",
    chambers: "cham-bers",
    renewable: "re-new-a-ble",
    examination: "ex-am-i-na-tion",
    question: "ques-tion",
    questions: "ques-tions",
    answer: "an-swer",
    answers: "an-swers",
    explain: "ex-plain",
    describe: "de-scribe",
    calculate: "cal-cu-late",
    difference: "dif-fer-ence",
    differences: "dif-fer-enc-es",
    kilometres: "ki-lo-me-tres",
    kilometre: "ki-lo-me-tre",
    average: "av-er-age",
    particles: "par-ti-cles",
    energy: "en-er-gy",
    sources: "sourc-es",
    general: "gen-er-al",
    science: "sci-ence",
    important: "im-por-tant",
    following: "fol-low-ing",
    information: "in-for-ma-tion",
    photosynthesis: "pho-to-syn-the-sis",
    evaporation: "evap-o-ra-tion",
    condensation: "con-den-sa-tion",
    temperature: "tem-per-a-ture",
    environment: "en-vi-ron-ment",
    electricity: "elec-tri-ci-ty",
    experiment: "ex-per-i-ment",
    hypothesis: "hy-poth-e-sis",
    microscope: "mi-cro-scope",
    organism: "or-gan-ism",
    ecosystem: "ec-o-sys-tem",
    equation: "e-qua-tion",
    fraction: "frac-tion",
    fractions: "frac-tions",
    decimal: "dec-i-mal",
    percentage: "per-cent-age",
    hypotenuse: "hy-pot-e-nuse",
    theorem: "the-o-rem",
    triangle: "tri-an-gle",
    rectangle: "rec-tan-gle",
    perimeter: "pe-rim-e-ter",
    multiply: "mul-ti-ply",
    simplify: "sim-pli-fy",
    paragraph: "par-a-graph",
    government: "gov-ern-ment",
    oxygen: "ox-y-gen",
    carbon: "car-bon",
    melting: "melt-ing",
    between: "be-tween",
    hundred: "hun-dred",
  };
  var DIGRAPHS = ["tch", "dge", "th", "sh", "ch", "ph", "wh", "ck", "ng", "qu"];

  /** Return case-preserving reading chunks; their concatenation equals the input. */
  function syllableChunks(core) {
    core = String(core || "");
    if (!core) return [core];
    var low = core.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CHUNK_EXC, low)) {
      var i = 0;
      return CHUNK_EXC[low].split("-").map(function (p) {
        var s = core.substr(i, p.length);
        i += p.length;
        return s;
      });
    }
    var groups = [],
      m;
    var re = /[aeiouy]+/gi;
    while ((m = re.exec(low))) groups.push([m.index, m.index + m[0].length]);
    var bounds = [];
    for (var g = 0; g < groups.length - 1; g++) {
      var s = groups[g][1],
        e = groups[g + 1][0];
      var cl = low.slice(s, e);
      if (!cl.length) {
        bounds.push(s);
        continue;
      }
      if (cl.length === 1) bounds.push(s);
      else if (
        DIGRAPHS.indexOf(cl) >= 0 ||
        DIGRAPHS.indexOf(cl.slice(0, 2)) >= 0
      )
        bounds.push(s);
      else bounds.push(s + 1);
    }
    var ok = [],
      prev = 0;
    for (var bi = 0; bi < bounds.length; bi++) {
      var b = bounds[bi];
      if (b - prev < 2 || core.length - b < 2) continue;
      if (b >= core.length - 1) continue;
      ok.push(b);
      prev = b;
    }
    if (!ok.length) return [core];
    var parts = [],
      last = 0;
    for (var pi = 0; pi < ok.length; pi++) {
      parts.push(core.slice(last, ok[pi]));
      last = ok[pi];
    }
    parts.push(core.slice(last));
    return parts;
  }

  // Splits "word," into { pre:'', core:'word', post:',' } for safe chunk rendering.
  function splitToken(token) {
    var m = String(token || "").match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
    if (!m) return null;
    return { pre: m[1], core: m[2], post: m[3] };
  }

  var CHUNK_MIN_LEN = CONFIG.longWordLength; // words shorter than this are left whole

  /* ---------- reading assistant (explainable rules, no AI/ML) ---------- */
  var LONG_WORD_MIN = CONFIG.longWordLength;

  var PROFILES = {
    none: { label: "Manual settings" },
    dyslexia: { label: "Dyslexia" },
    lowvision: { label: "Low vision" },
    focus: { label: "Focus / ADHD" },
    esl: { label: "Second-language reader" },
    time: { label: "Time pressure" },
  };

  // Stats about the pasted paper that drive the paper-based rules.
  /** Measure numbered questions; headers do not affect paper density. */
  function paperStats(questions) {
    var words = 0,
      longWords = 0,
      marks = 0,
      n = 0;
    (questions || []).forEach(function (q) {
      if (!q.num) return; // intro/header block is not a question
      n++;
      stripMarks(q.text)
        .split(/\s+/)
        .forEach(function (w) {
          var t = splitToken(w);
          var core = t ? t.core : w.replace(/[^A-Za-z]/g, "");
          if (!core) return;
          words++;
          if (core.length >= LONG_WORD_MIN) longWords++;
        });
      var m = extractMarks(q.text);
      if (m) marks += parseInt(m, 10);
    });
    var avg = n ? words / n : 0;
    return {
      questionCount: n,
      totalWords: words,
      totalMarks: marks,
      avgWordsPerQuestion: Math.round(avg * 10) / 10,
      longWordRatio: words ? longWords / words : 0,
      dense: avg >= CONFIG.denseQuestionWords,
      heavyVocabulary: words
        ? longWords / words >= CONFIG.heavyVocabularyRatio
        : false,
    };
  }

  // Deterministic, explainable recommendation. Every change comes with a reason.
  /** Published presets. Recommendations are data, not hidden model behavior. */
  var PROFILE_PRESETS = {
    none: {
      settings: {
        size: 0,
        spacing: 0,
        tint: "",
        contrast: "none",
        spotlight: true,
        chunk: false,
        ruler: false,
        aloud: false,
        profile: "none",
      },
      reasons: [],
    },
    dyslexia: {
      settings: {
        size: 0,
        spacing: 1,
        tint: "cream",
        contrast: "none",
        spotlight: true,
        chunk: true,
        ruler: false,
        aloud: true,
        profile: "dyslexia",
      },
      reasons: [
        "Chunk words on: splitting long words into sound chunks helps decoding.",
        "Relaxed spacing and a cream overlay: both reduce visual stress while reading.",
        "Question Spotlight on: one question at a time keeps your place.",
        "Read aloud on: hearing the question supports the reading.",
      ],
    },
    lowvision: {
      settings: {
        size: 3,
        spacing: 0,
        tint: "",
        contrast: "yellow",
        spotlight: true,
        chunk: false,
        ruler: false,
        aloud: true,
        profile: "lowvision",
      },
      reasons: [
        "Largest text size and yellow-on-black contrast: maximum legibility.",
        "Read aloud on: the browser voice can read every question to you.",
        "Question Spotlight on: only one question is on screen at a time.",
      ],
    },
    focus: {
      settings: {
        size: 1,
        spacing: 1,
        tint: "",
        contrast: "none",
        spotlight: true,
        chunk: false,
        ruler: true,
        aloud: false,
        profile: "focus",
      },
      reasons: [
        "Question Spotlight on: one question at a time removes distraction.",
        "Focus ruler on: in list view a soft band keeps your eyes on one line.",
        "Relaxed spacing and slightly larger text: easier to keep your place.",
      ],
    },
    esl: {
      settings: {
        size: 0,
        spacing: 1,
        tint: "",
        contrast: "none",
        spotlight: true,
        chunk: true,
        ruler: false,
        aloud: true,
        profile: "esl",
      },
      reasons: [
        "Chunk words on: long words split into sound chunks you can pronounce.",
        "Read aloud on: hear each word while it lights up.",
        "Relaxed spacing: word boundaries are easier to see.",
      ],
    },
    time: {
      settings: {
        size: 1,
        spacing: 0,
        tint: "",
        contrast: "none",
        spotlight: true,
        chunk: false,
        ruler: false,
        aloud: false,
        profile: "time",
      },
      reasons: [
        "Question Spotlight on: jump question to question with the arrow keys, fastest way through the paper.",
        "Slightly larger text: quicker first read of each question.",
      ],
    },
  };

  /** Return a fresh recommendation, never mutating a profile or caller data. */
  function recommend(profileKey, stats) {
    if (!Object.prototype.hasOwnProperty.call(PROFILE_PRESETS, profileKey))
      profileKey = "none";
    var preset = PROFILE_PRESETS[profileKey];
    var settings = mergeSettings(preset.settings);
    var reasons = preset.reasons.slice();
    if (stats && stats.heavyVocabulary && !settings.chunk) {
      settings.chunk = true;
      reasons.push(
        "This paper has many long words, so Chunk words was switched on automatically.",
      );
    }
    if (stats && stats.dense) {
      settings.spotlight = true;
      reasons.push(
        "This paper has long questions, so Question Spotlight is recommended to keep one question on screen.",
      );
    }
    return { settings: settings, reasons: reasons };
  }

  // A non-intrusive tip when no profile is chosen but the paper clearly needs help.
  function paperTip(stats) {
    if (!stats) return "";
    if (stats.dense)
      return "This paper has long questions on average. Question Spotlight shows one at a time - it is already on by default.";
    if (stats.heavyVocabulary)
      return "This paper uses many long words. Turning on Chunk words in Settings splits them into sound chunks.";
    return "";
  }

  /* ---------- sample paper ---------- */
  var SAMPLE =
    "SAMPLE MID-TERM EXAMINATION - GENERAL SCIENCE - TIME: 1 HOUR\n\n" +
    "1. What is the process by which plants make their own food using sunlight? [2 marks]\n\n" +
    "2. Name the organ in the human body that pumps blood, and state how many chambers it has. [2 marks]\n\n" +
    "3. Explain why the sky appears blue during the day. Write your answer in two or three sentences. [3 marks]\n\n" +
    "4. A train travels 120 kilometres in 2 hours. Calculate its average speed in kilometres per hour. [3 marks]\n\n" +
    "5. List any three differences between renewable and non-renewable sources of energy. [3 marks]\n\n" +
    "6. Describe what happens to the particles of a solid when it is heated until it melts. [2 marks]";

  /** Offline fallback: organize the same question into parts, never invent an answer. */
  function localReadingAid(question) {
    var text = stripMarks(String(question || "")).trim();
    if (!text) return "Choose a question first.";
    var parts = text.split(/(?<=[.!?])\s+/u);
    var steps = parts.map(function (part, index) {
      return index + 1 + ". " + part.trim();
    });
    return (
      "Read one part at a time:\n\n" +
      steps.join("\n\n") +
      "\n\nUse the original question and marks above as your source."
    );
  }

  return {
    CONFIG: CONFIG,
    localReadingAid: localReadingAid,
    validatePaper: validatePaper,
    createSettingsStore: createSettingsStore,
    wordIndexAt: wordIndexAt,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SIZE_STEPS: SIZE_STEPS,
    TINTS: TINTS,
    clampSize: clampSize,
    mergeSettings: mergeSettings,
    parseQuestions: parseQuestions,
    extractMarks: extractMarks,
    stripMarks: stripMarks,
    syllableChunks: syllableChunks,
    splitToken: splitToken,
    CHUNK_MIN_LEN: CHUNK_MIN_LEN,
    LONG_WORD_MIN: LONG_WORD_MIN,
    PROFILES: PROFILES,
    paperStats: paperStats,
    recommend: recommend,
    paperTip: paperTip,
    SAMPLE: SAMPLE,
  };
});
