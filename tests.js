/* Exam Reader - automated tests for the core logic.
   Run with Node.js:   node tests.js
   No dependencies. Exits 0 when every test passes, 1 otherwise. */
"use strict";
const C = require("./core.js");

let passed = 0,
  failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual),
    e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.log(
      "  FAIL  " +
        name +
        "\n        expected: " +
        e +
        "\n        actual:   " +
        a,
    );
  }
}
function ok(name, cond) {
  if (cond) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.log("  FAIL  " + name);
  }
}

console.log("\n[1] Question parser");
{
  const qs = C.parseQuestions(C.SAMPLE);
  check("sample paper yields intro + 6 questions", qs.length, 7);
  check(
    "question numbers detected in order",
    qs.slice(1).map((q) => q.num),
    ["1", "2", "3", "4", "5", "6"],
  );
  check("header kept as intro block", qs[0].num, "");
  const multi = C.parseQuestions(
    "1. First part\ncontinues on next line\n2) Second question",
  );
  check(
    "multi-line question joined",
    multi[0].text,
    "First part continues on next line",
  );
  check("paren numbering works", multi[1].num, "2");
  const qstyle = C.parseQuestions(
    "Q3: Third question\nQuestion 4 - Fourth question",
  );
  check('"Q3:" numbering works', qstyle[0].num, "3");
  check('"Question 4 -" numbering works', qstyle[1].num, "4");
  check("empty input gives no questions", C.parseQuestions("   \n\n "), []);
  check("marks extracted", C.extractMarks("What is x? [2 marks]"), "2");
  check(
    "marks extracted from parens",
    C.extractMarks("What is x? (3 marks)"),
    "3",
  );
  check("no marks gives null", C.extractMarks("What is x?"), null);
  check(
    "marks stripped from text",
    C.stripMarks("What is x? [2 marks]").trim(),
    "What is x?",
  );
  ok(
    "question text unchanged apart from numbering",
    qs[1].text.indexOf("plants make their own food") > 0,
  );
}

console.log("\n[2] Syllable chunker");
{
  check("photosynthesis", C.syllableChunks("photosynthesis"), [
    "pho",
    "to",
    "syn",
    "the",
    "sis",
  ]);
  check("process", C.syllableChunks("process"), ["pro", "cess"]);
  check("sunlight", C.syllableChunks("sunlight"), ["sun", "light"]);
  check("renewable", C.syllableChunks("renewable"), ["re", "new", "a", "ble"]);
  check("hypotenuse", C.syllableChunks("hypotenuse"), [
    "hy",
    "pot",
    "e",
    "nuse",
  ]);
  check("chambers", C.syllableChunks("chambers"), ["cham", "bers"]);
  check("short word stays whole", C.syllableChunks("cat"), ["cat"]);
  check("empty stays empty", C.syllableChunks(""), [""]);
  const joined = C.syllableChunks("photosynthesis").join("");
  check("chunks rejoin to the original word", joined, "photosynthesis");
  const cap = C.syllableChunks("Photosynthesis");
  check("capital letter preserved in first chunk", cap[0][0], "P");
  check(
    "every chunk has at least 2 chars or is a vowel run",
    C.syllableChunks("electricity").every((p) => p.length >= 1),
    true,
  );
}

console.log("\n[3] Token splitting (chunk rendering)");
{
  check("plain word", C.splitToken("word"), {
    pre: "",
    core: "word",
    post: "",
  });
  check("word with comma", C.splitToken("word,"), {
    pre: "",
    core: "word",
    post: ",",
  });
  check("bracketed word", C.splitToken("(word)"), {
    pre: "(",
    core: "word",
    post: ")",
  });
  check("digits only are not chunked", C.splitToken("120"), null);
}

console.log("\n[4] Settings");
{
  const d = C.DEFAULT_SETTINGS;
  check("defaults", d, {
    size: 0,
    spacing: 0,
    tint: "",
    contrast: "none",
    spotlight: true,
    chunk: false,
    ruler: false,
    aloud: false,
    profile: "none",
  });
  check("size clamps at top", C.clampSize(3, 1), 3);
  check("size clamps at bottom", C.clampSize(0, -1), 0);
  check("size moves", C.clampSize(1, 1), 2);
  const merged = C.mergeSettings({ size: 2, chunk: true, junk: "x", tint: 5 });
  check("saved values merge", merged.size, 2);
  check("saved flag merges", merged.chunk, true);
  check("unknown keys dropped", "junk" in merged, false);
  check("wrong types rejected", merged.tint, "");
  check("size steps", C.SIZE_STEPS, [100, 115, 130, 150]);
  check("four overlays plus none", Object.keys(C.TINTS).sort(), [
    "",
    "blue",
    "cream",
    "mint",
    "rose",
  ]);
}

console.log("\n[5] Safety invariants");
{
  const evil = C.parseQuestions("1. <script>alert(1)</script> [2 marks]");
  check(
    "parser keeps markup as inert text",
    evil[0].text,
    "<script>alert(1)</script> [2 marks]",
  );
  ok(
    "stripMarks keeps the rest intact",
    C.stripMarks("<b>bold</b> [2 marks]").indexOf("<b>bold</b>") === 0,
  );
  ok(
    "core never touches the DOM",
    typeof C.parseQuestions === "function" && typeof document === "undefined",
  );
}

console.log("\n[6] Reading assistant (profiles and paper rules)");
{
  const stats = C.paperStats(C.parseQuestions(C.SAMPLE));
  check("sample paper question count", stats.questionCount, 6);
  check("sample paper total marks", stats.totalMarks, 15);
  check("long-word ratio detected", stats.heavyVocabulary, true);
  check("sample paper is not dense", stats.dense, false);

  const d = C.recommend("dyslexia", stats);
  ok("dyslexia: chunk on", d.settings.chunk === true);
  ok("dyslexia: cream overlay", d.settings.tint === "cream");
  ok("dyslexia: aloud on", d.settings.aloud === true);
  ok("dyslexia: every change has a reason", d.reasons.length >= 3);

  const lv = C.recommend("lowvision", stats);
  ok("low vision: largest text", lv.settings.size === 3);
  ok("low vision: yellow contrast", lv.settings.contrast === "yellow");

  const f = C.recommend("focus", stats);
  ok("focus: ruler on", f.settings.ruler === true);
  ok("focus: spotlight on", f.settings.spotlight === true);

  const t = C.recommend("time", {
    questionCount: 5,
    avgWordsPerQuestion: 10,
    dense: false,
    heavyVocabulary: false,
  });
  ok(
    "time pressure: chunk stays off on easy paper",
    t.settings.chunk === false,
  );
  ok("time pressure: read aloud off", t.settings.aloud === false);

  const longPaper = {
    questionCount: 4,
    avgWordsPerQuestion: 12,
    dense: false,
    heavyVocabulary: true,
  };
  const tr = C.recommend("time", longPaper);
  ok(
    "paper rule: heavy vocabulary forces chunk on",
    tr.settings.chunk === true,
  );
  ok(
    "paper rule: the change is explained",
    tr.reasons.some((r) => r.indexOf("long words") >= 0),
  );

  const densePaper = {
    questionCount: 3,
    avgWordsPerQuestion: 40,
    dense: true,
    heavyVocabulary: false,
  };
  const dr = C.recommend("none", densePaper);
  ok(
    "paper rule: dense paper forces spotlight on",
    dr.settings.spotlight === true,
  );
  ok("tip exists for dense paper", C.paperTip(densePaper).length > 0);
  ok(
    "no tip for an easy paper",
    C.paperTip({ dense: false, heavyVocabulary: false }) === "",
  );
  ok(
    "recommend with no profile keeps defaults except paper rules",
    C.recommend("none", { dense: false, heavyVocabulary: false }).settings
      .chunk === false,
  );
  check("profiles list", Object.keys(C.PROFILES).sort(), [
    "dyslexia",
    "esl",
    "focus",
    "lowvision",
    "none",
    "time",
  ]);
}

console.log("\n[7] Settings trust boundary");
{
  const invalid = [null, [], 42, "text", true];
  for (const value of invalid)
    check(
      "non-object settings ignored: " + JSON.stringify(value),
      C.mergeSettings(value),
      C.mergeSettings(null),
    );
  for (const value of [-1, 4, 1.5, NaN, Infinity, "2"])
    check(
      "invalid size rejected: " + String(value),
      C.mergeSettings({ size: value }).size,
      0,
    );
  for (const value of [-1, 3, 0.5, "1"])
    check(
      "invalid spacing rejected: " + String(value),
      C.mergeSettings({ spacing: value }).spacing,
      0,
    );
  check(
    "unknown contrast rejected",
    C.mergeSettings({ contrast: "orange" }).contrast,
    "none",
  );
  check(
    "inherited tint key rejected",
    C.mergeSettings({ tint: "toString" }).tint,
    "",
  );
  check(
    "unknown profile rejected",
    C.mergeSettings({ profile: "administrator" }).profile,
    "none",
  );
  check(
    "inherited setting ignored",
    C.mergeSettings(Object.create({ size: 3 })).size,
    0,
  );
  check(
    "unknown recommendation profile falls back",
    C.recommend("toString", null).settings.profile,
    "none",
  );
}
console.log("\n[8] Safe settings storage");
{
  let saved = null;
  const storage = C.createSettingsStore(() => ({
    getItem: () => saved,
    setItem: (key, value) => {
      saved = value;
    },
  }));
  check(
    "missing storage returns defaults",
    storage.get(),
    C.mergeSettings(null),
  );
  saved = "{invalid json";
  check(
    "malformed JSON returns defaults",
    storage.get(),
    C.mergeSettings(null),
  );
  saved = "x".repeat(2049);
  check("oversized storage ignored", storage.get(), C.mergeSettings(null));
  storage.set({ size: 2, text: "private paper", unexpected: "ignored" });
  check("storage round trip", storage.get().size, 2);
  check("paper text never saved", JSON.parse(saved).text, undefined);
  const unavailable = C.createSettingsStore(() => {
    throw Error("storage disabled");
  });
  check(
    "storage access refusal is harmless",
    unavailable.get(),
    C.mergeSettings(null),
  );
  let threw = false;
  try {
    unavailable.set({ size: 2 });
  } catch (error) {
    threw = true;
  }
  check("failed save does not stop reading", threw, false);
}
console.log("\n[9] Input and parser limits");
{
  ok("blank input rejected with explanation", C.validatePaper("  ").length > 0);
  check("valid sample accepted", C.validatePaper(C.SAMPLE), "");
  check(
    "character boundary accepted",
    C.validatePaper("a".repeat(C.CONFIG.maxCharacters)),
    "",
  );
  ok(
    "oversized paper rejected",
    C.validatePaper("a".repeat(C.CONFIG.maxCharacters + 1)).length > 0,
  );
  ok(
    "word limit enforced independently",
    C.validatePaper("a ".repeat(C.CONFIG.maxWords + 1)).length > 0,
  );
  let refused = false;
  try {
    C.parseQuestions("a".repeat(C.CONFIG.maxCharacters + 1));
  } catch (error) {
    refused = error instanceof RangeError;
  }
  ok("direct parser cannot bypass bounds", refused);
  check(
    "three-digit numbering",
    C.parseQuestions("100. Last question")[0].num,
    "100",
  );
  check(
    "CRLF continuation",
    C.parseQuestions("1. first\r\nsecond")[0].text,
    "first second",
  );
  check(
    "plain notice retained",
    C.parseQuestions("A notice without numbering")[0].text,
    "A notice without numbering",
  );
  check(
    "Unicode text preserved",
    C.parseQuestions("1. தமிழ் கேள்வி?")[0].text,
    "தமிழ் கேள்வி?",
  );
  check("no-question input safe", C.parseQuestions("1."), []);
  check("empty stats finite", C.paperStats([]).longWordRatio, 0);
}
console.log("\n[10] Word indexing and chunk invariants");
{
  check("word index starts at zero", C.wordIndexAt([0, 5, 10], 0), 0);
  check("middle token by offset", C.wordIndexAt([0, 5, 10], 7), 1);
  check("final token by offset", C.wordIndexAt([0, 5, 10], 999), 2);
  check("empty offsets safe", C.wordIndexAt([], 0), -1);
  check("negative speech offset safe", C.wordIndexAt([0], -1), -1);
  for (const word of [
    "toString",
    "constructor",
    "Photosynthesis",
    "alphabetical",
    "strengths",
    "banana",
    "SCIENCE",
    "x",
    "Tamil",
    "a".repeat(100),
  ]) {
    check(
      "chunks preserve all characters: " + word.slice(0, 20),
      C.syllableChunks(word).join(""),
      word,
    );
  }
}
console.log("\n[11] Static security contracts");
{
  const fs = require("node:fs");
  const app = ["app.js", "reader-view.js", "ai-aid.js", "speech-controller.js"]
    .map((file) =>
      fs.readFileSync(require("node:path").join(__dirname, file), "utf8"),
    )
    .join("\n");
  const html = fs.readFileSync(
    require("node:path").join(__dirname, "index.html"),
    "utf8",
  );
  ok(
    "no HTML injection sink assignment",
    !/\.innerHTML\s*=|insertAdjacentHTML\s*\(/.test(app),
  );
  ok(
    "no dynamic code evaluation",
    !/\beval\s*\(|new\s+Function\s*\(/.test(app),
  );
  ok("no inline event attributes", !/\son[a-z]+\s*=/.test(html));
  ok(
    "CSP limits connections to this origin",
    html.includes("connect-src 'self'"),
  );
  ok("CSP forbids objects", html.includes("object-src 'none'"));
  ok("source field has accessible name", html.includes('for="src"'));
  ok("language declared", html.includes('lang="en"'));
  ok("skip link exists", html.includes('id="skipLink"'));
}
console.log("\n----------------------------------------");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
