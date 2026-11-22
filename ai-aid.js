/* Optional reading aid controller. Owns consent, cancellation and memory-only caching. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExamReaderAiAid = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** State is read on each click so navigation and profile changes cannot go stale. */
  function create({ Core, byId, getState }) {
    const AI_CLIENT_LIMITS = Object.freeze({
      questionCharacters: 6000,
      responseCharacters: 8000,
      requestTimeoutMs: 12000,
      cacheEntries: 50,
    });
    const aiCache = new Map();
    let aiRequestId = 0;
    let aiController = null;

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
    /** Accept only the two known result sources and a bounded, nonempty text aid. */
    function isUsableAiResult(result) {
      return (
        ["gemini", "local"].includes(result.source) &&
        typeof result.text === "string" &&
        result.text.length > 0 &&
        result.text.length <= AI_CLIENT_LIMITS.responseCharacters
      );
    }

    /** One explicit click, one question, one same-origin request. Never an automatic upload. */
    async function simplifySelectedQuestion() {
      const { questions, currentQuestionIndex, settings } = getState();
      if (!byId("aiConsent").checked || !questions[currentQuestionIndex])
        return;
      const question = questions[currentQuestionIndex].text;
      const profile = settings.profile;
      const key = JSON.stringify([question, profile]);
      const fallback = {
        source: "local",
        text: Core.localReadingAid(question),
      };
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
          question.length > AI_CLIENT_LIMITS.questionCharacters
        ) {
          showAiAid(fallback);
          return;
        }
        timeout = setTimeout(
          () => controller.abort(),
          AI_CLIENT_LIMITS.requestTimeoutMs,
        );
        const response = await fetch("/api/simplify", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, profile }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (requestId !== aiRequestId) return;
        if (!isUsableAiResult(result)) {
          showAiAid(fallback);
          return;
        }
        if (result.source === "gemini") {
          if (aiCache.size >= AI_CLIENT_LIMITS.cacheEntries)
            aiCache.delete(aiCache.keys().next().value);
          aiCache.set(key, result);
        }
        showAiAid(result);
      } catch {
        if (requestId === aiRequestId) showAiAid(fallback);
      } finally {
        clearTimeout(timeout);
        if (requestId === aiRequestId) {
          byId("simplifyBtn").disabled = !byId("aiConsent").checked;
          aiController = null;
        }
      }
    }
    byId("simplifyBtn").addEventListener("click", simplifySelectedQuestion);

    byId("localAidBtn").addEventListener("click", () => {
      const { questions, currentQuestionIndex } = getState();
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

    return Object.freeze({
      reset: resetAiAid,
      clearCache: () => aiCache.clear(),
    });
  }
  return Object.freeze({ create });
});
