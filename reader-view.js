/* DOM-safe paper rendering. This module never owns navigation or speech state. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExamReaderView = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Return token metadata to the caller instead of mutating shared UI arrays. */
  function create({ Core, createElement, getSettings }) {
    function appendToken(span, token) {
      const settings = getSettings();
      if (!settings.chunk) {
        span.appendChild(createElement("span", "w", token));
        return;
      }
      const tokenParts = Core.splitToken(token);
      if (!tokenParts || tokenParts.core.length < Core.CHUNK_MIN_LEN) {
        span.appendChild(createElement("span", "w", token));
        return;
      }
      const parts = Core.syllableChunks(tokenParts.core);
      if (parts.length < 2) {
        span.appendChild(createElement("span", "w", token));
        return;
      }
      const w = createElement("span", "w");
      w.appendChild(document.createTextNode(tokenParts.pre));
      parts.forEach((p, i) => {
        if (i) {
          const separator = createElement("span", "chunk", "·");
          separator.setAttribute("aria-hidden", "true");
          w.appendChild(separator);
        }
        w.appendChild(document.createTextNode(p));
      });
      w.appendChild(document.createTextNode(tokenParts.post));
      span.appendChild(w);
    }

    /** Build one question and cache speech token offsets. */
    function appendQuestion(container, question, questionIndex, startIndex) {
      const div = createElement("div", "q" + (question.num ? "" : " intro"));
      div.dataset.q = questionIndex;
      if (question.num)
        div.appendChild(createElement("span", "qn", "Q" + question.num));
      const marks = Core.extractMarks(question.text);
      if (marks)
        div.appendChild(createElement("span", "marks", marks + " marks"));
      const words = Core.stripMarks(question.text).split(/\s+/).filter(Boolean);
      const span = createElement("span", "qt");
      words.forEach((w, i) => {
        if (i) span.appendChild(document.createTextNode(" "));
        appendToken(span, w);
      });
      div.appendChild(span);
      container.appendChild(div);
      const elements = [...span.querySelectorAll(".w")];
      let characterOffset = 0;
      const offsets = words.map((word) => {
        const start = characterOffset;
        characterOffset += word.length + 1;
        return start;
      });
      return {
        elements,
        start: startIndex,
        count: elements.length,
        text: words.join(" "),
        words,
        offsets,
      };
    }

    return Object.freeze({ appendQuestion });
  }
  return Object.freeze({ create });
});
