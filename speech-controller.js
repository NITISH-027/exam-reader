/* Local speech and follow-along controller. Owns timer and stale-session guards. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExamReaderSpeech = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function create({
    Core,
    byId,
    announce,
    getState,
    getNavigation,
    navigate,
    motionBehavior,
  }) {
    let speaking = false;
    let timer = null;
    let highlightedWord = null;
    let speechSession = 0;
    function clearSaid() {
      if (highlightedWord) highlightedWord.classList.remove("said");
      highlightedWord = null;
    }
    function highlightWord(index) {
      const { wordElements } = getState();
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
      const { settings, questionWords, currentQuestionIndex, wordElements } =
        getState();
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
      const { questionWords, settings, currentQuestionIndex, questions } =
        getState();
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
      const questionSequence = settings.spotlight
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
      let sequenceIndex = 0;
      const next = () => {
        const { settings, currentQuestionIndex, questionWords } = getState();
        if (!speaking || session !== speechSession) return;
        if (sequenceIndex >= questionSequence.length) {
          stopSpeak();
          if (settings.aloud && settings.spotlight) {
            const nav = getNavigation();
            const position = nav.indexOf(currentQuestionIndex);
            if (position < nav.length - 1) navigate(nav[position + 1], true);
          }
          return;
        }
        const questionTokens = questionWords[questionSequence[sequenceIndex]];
        const utterance = new SpeechSynthesisUtterance(questionTokens.text);
        utterance.rate = Core.CONFIG.speechRate;
        utterance.voice =
          voices.find((voice) => /^en/i.test(voice.lang)) || voices[0];
        utterance.onboundary = (event) => {
          if (session !== speechSession || !speaking) return;
          const wordIndex = Core.wordIndexAt(
            questionTokens.offsets,
            event.charIndex,
          );
          if (wordIndex >= 0) highlightWord(questionTokens.start + wordIndex);
        };
        utterance.onend = () => {
          if (session === speechSession) {
            sequenceIndex++;
            next();
          }
        };
        utterance.onerror = () => {
          if (session === speechSession && speaking) startFollowAlong();
        };
        speechSynthesis.speak(utterance);
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

    return Object.freeze({ toggle: speak, stop: stopSpeak });
  }
  return Object.freeze({ create });
});
