# Exam Reader

**Same question, readable by everyone.**

A context-aware reading assistant for exam text. Choose a reading profile,
paste a paper, and get reading settings with a reason for every recommendation.
The original question and marks are never replaced. Optional Gemini rewording appears only as a separate, clearly labelled reading aid after consent and a click.

Built by Nitish Prabagaran for PromptWars x Techverse.

## Chosen vertical

**Accessibility and Inclusion:** nobody left out because of how they see,
hear, speak, read or learn.

### Root problem

An exam should assess subject knowledge, not a student's ability to decode a
dense page. Small type, crowded questions, difficult vocabulary and losing
one's place can get between a student and the question they need to answer.

### User needs and objectives

| Need                                    | Objective                                             | Working feature                                                                      |
| --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Small or hard-to-see text               | Make the same question easier to perceive             | Four text sizes, contrast modes, local read-aloud                                    |
| Difficulty decoding long words          | Offer a different way to follow the same words        | English word chunking, optional spacing, word highlighting                           |
| Distraction or losing one's place       | Reduce competing content                              | Question Spotlight, focus ruler, keyboard question navigation                        |
| Reading in a second language            | Hear and follow the original text                     | Local voice plus visible text, optional chunking; no translation                     |
| Hearing or speech differences           | Never require spoken input or audio-only instructions | Every question and control is visual; keyboard and paste input work without speaking |
| Limited connectivity or a shared device | Keep the workflow local and simple                    | Local reading needs no account, key or upload; optional Gemini is separate           |

## Approach and logic

The default reading assistant is deterministic. Its inputs are an explicit reader choice and measurable properties of the paper. The separate, optional Gemini aid uses a generative model and is never required for these rules.

1. **Reader context.** Choose Dyslexia, Low vision, Focus / ADHD,
   Second-language reader or Time pressure. Published presets in `core.js`
   choose size, spacing, tint, contrast, spotlight, chunking and read-aloud.
   Manual settings keeps the current settings without choosing a profile.
2. **Paper context.** The parser finds numbered questions and marks.
   `paperStats()` calculates question count, total marks, average question
   length and the proportion of words with at least seven English letters.
   Headings do not inflate these measurements.
3. **Decision rules.** At least 12% long words adds chunking. An average of
   at least 25 words per question recommends keeping Question Spotlight on.
   With no profile selected, the paper produces a tip instead of changing settings.
4. **Explanation and control.** A checked purple profile chip and a
   `Selected: ...` panel show the choice and reasons. Profiles are starting
   points, not diagnoses. Settings remain available to change in the reader.

The defaults and thresholds are together in `core.js`. Profile presets are
plain data. Recommendations return new objects, so one session cannot mutate
the defaults for another.

## How the solution works

1. Open the app and paste plain text, or load the sample paper.
2. Optionally select a reading profile. The page remains lilac; colour
   overlays affect only the question-reading card.
3. Start reading. Use Spotlight for one question at a time, or turn it off
   for list view. Previous/Next and arrow keys move between questions.
4. Adjust text size, spacing, colour overlay and contrast. Settings includes
   chunking and the focus ruler. In list view, Alt+Up/Down also moves the ruler.
5. Play read-aloud. Only local device voices are used. If none are available,
   timed word highlighting provides a visual follow-along mode instead.

## Optional Gemini reading aid

Expand **Simplify with AI** under the current question. Its privacy notice explains
that the chosen question and reading profile will go to Google. The checkbox is
unchecked for every new question. Only checking it and clicking the AI button
calls the server. Merely pasting, selecting a profile or navigating sends nothing.
The original question and marks remain unchanged above the aid.

A separate **Local guide (no upload)** button works without consent, a key or a
connection. If Gemini is unavailable, the same deterministic guide is labelled
as local, never presented as an AI result. AI rewording may be inaccurate and
must be checked against the original. For this free-tier demo, use only sample/public text and a demo reading profile.
Google may use free-tier content to improve products. Do not send private papers,
confidential material or personal data.

## Run locally

Double-click `index.html`, or run these PowerShell commands from the folder
containing the extracted `exam-reader` folder, one command per line:

```powershell
cd exam-reader
python -m http.server 8000
```

Open http://localhost:8000. No build or dependency installation is needed for local reading. To use the optional API server, install Node.js 22.x and run `npm start`; open http://localhost:8080. With no configured key the server returns the local guide.
An already open page works without a connection. Use the downloaded folder
to reopen the app offline; the hosted page is not an installed offline app.

## Architecture and code quality, high impact

| File                      | Responsibility                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `core.js`                 | Pure parser, validation, settings schema/storage adapter, chunker, rule presets and paper analysis |
| `app.js`                  | DOM-only rendering, navigation, local speech, focus ruler and controls                             |
| `index.html`              | Three semantic screens, labelled controls, CSP and live regions                                    |
| `style.css`               | Lilac theme, responsive layouts, contrast and reduced-motion styles                                |
| `tests.js`                | Dependency-free unit and static-contract tests                                                     |
| `browser-tests.py`        | Optional real-browser workflow and regression tests                                                |
| `server.js`, `Dockerfile` | Node HTTP server and non-root container with response security headers                             |

Additional modules: `ai-service.js` validates and calls Gemini; `server.test.js`
tests it with injected fetch and a real local HTTP server. `ai-browser-tests.py`
checks consent, one-question disclosure, unchanged originals and safe UI fallback.

Named helpers separate question construction, progress, recommendations,
storage and speech. The UI and tests use the same core functions.
Comments describe contracts and decisions rather than restating individual lines.

## Security and efficiency, medium impact

- Pasted text becomes DOM text nodes, never executable HTML. No dynamic code
  evaluation, inline event attributes or third-party runtime libraries. The optional Gemini action uses a same-origin API call only after consent.
- CSP restricts scripts and browser connections to this origin, and blocks forms and objects.
  The Node server also sends anti-framing and content-type protection headers.
  Inline styles are allowed for computed font, tint and ruler positions, not scripts.
- Local voices only: the app does not hand exam text to an online voice service.
- A paper over 50,000 characters or 8,000 words is rejected with an explanation.
  It is never silently cut off. The core parser enforces the same bounds as the UI.
- Only allowlisted, range-checked preferences are saved. Invalid JSON,
  inherited keys, oversized storage records and unavailable local storage are safe.
  Question text is not written to storage.
- Parsing and paper statistics are cached for unchanged input. Parsing does not
  run on every keystroke; the input status is debounced.
- Speech token offsets and navigation indices are cached. A boundary uses binary
  search and changes only the previous and current highlight, not every word.
- Ruler drawing uses one animation-frame request while the pointer moves,
  with no idle polling loop. Leaving the page cancels speech.

## Testing and accessibility

Node.js 22.x runs the optional server and the tests. Opening the local reading app directly does not need Node.
No npm dependencies or installation step is needed.

```powershell
npm test
npm run check
```

`node tests.js` runs the core suite alone; `npm test` also runs the server/provider suite. See `TESTING.md` for
coverage, optional browser-test setup and a manual demo checklist.

The app includes labelled native controls, visible keyboard focus, a skip link
that follows the active screen, question announcements, toggle states and
progress semantics. Tool popovers take keyboard focus and return it on Escape.
Decorative chunk dots are hidden from assistive reading. Reduced-motion settings
also change scripted scrolling. All seven mobile tools remain available.

## Assumptions made

- The reader uses a modern browser and provides plain text, not an image/PDF.
- English word chunking is a reading heuristic. Other scripts remain text and
  are not translated or rewritten. The profiles do not diagnose a condition.
- Numbered questions start on new lines, with forms such as `1.`, `2)`,
  `Q3:` or `Question 4 -`. Headers and continuation lines are retained.
- Local voice availability and word-boundary events vary by browser and device;
  a visual fallback is always provided when no local voice is available.
- Use in a live exam must follow that exam's accommodation rules.

## Google Services: actual implementation

- **Gemini API:** `ai-service.js` calls Google's `generateContent` REST endpoint
  with a server-only API key in an authentication header. The selected question
  and allowlisted reader profile are the only user context in the request.
  System instructions ask for rewording, not an answer. No model tools, browsing
  or external actions are enabled.
- **Hosting choice:** `server.js` serves the static reader and `POST /api/simplify`
  on Render or Cloud Run. Render setup is in `RENDER.md`; Cloud Run is optional
  in `DEPLOY.md`. Neither host is claimed to be deployed by this source package.
  The server honours the host's `PORT` and binds to `0.0.0.0`.
- **Secret handling:** Render stores `GEMINI_API_KEY` as a server environment
  variable. The optional Cloud Run route uses Secret Manager instead. The key
  is never part of a browser response, source file or browser configuration.
  The Dockerfile remains a non-root Node container, defaulting to port **8080**.
- The local Web Speech API is a browser standard, not a Google-service claim.

The default Gemini model is `gemini-3.8-flash`, checked against the linked official
model documentation. `GEMINI_MODEL` can select another available model without
changing the app. Model access depends on the key's project and quota.

The integration is implemented and tested with mocked provider responses.
An operator must configure their own key, deploy, and verify a real response
before calling the deployed AI feature live. No Google evaluation points or
score are guaranteed. See `SOURCES.md` for the official API/deployment references.

### API safety and cost controls

The endpoint accepts JSON with only `question` (up to 6,000 characters) and an
allowlisted `profile`. Bodies are limited to 24 KB. Cross-origin browser calls
are refused, no permissive CORS is sent, and static serving uses an allowlist
that does not expose server source, credentials, tests or dotfiles.

Requests time out after 10 seconds; output is bounded and rendered as text.
Provider errors/details and questions are not logged. Valid failures produce a
clearly labelled local guide. The server limits six requests per client address
per minute, 60 total per process per hour, and two simultaneous provider calls.
The optional Cloud Run deployment uses zero minimum and one maximum instance,
with request-based CPU. Render Free runs a single service instance that can sleep.
Successful answers are reused only
in the requesting browser's memory, not stored on the server.

**These controls are not authentication or a hard billing ceiling.** Process
counters reset on restart, and a public endpoint can be abused. Keep the Gemini key in a separate Free Tier project with no billing linked;
verify that status in AI Studio. On Render, put the key only in the server
environment variable. If using Cloud Run instead, keep Cloud Run/Secret Manager
in the event-credit hosting project and check its credit status. Do not upgrade Gemini billing or
set up Prepay. If free quota is unavailable, the app falls back locally.
Free-tier text may be used by Google to improve products, so no private papers
or personal data in the demo. Disable the key or remove the deployment after
the event if it is no longer needed. Hosting resources use their host's credit/quota; Render Free also has shared
workspace limits and cold starts. These controls are not an absolute spending guarantee.

## Deploy on Render or optionally Cloud Run

For the Render Free Node Web Service route, follow **`RENDER.md`**. Build command:
`npm run check`. Start command: `npm start`. Health check: `/healthz`. Enter the
key privately as the server environment variable `GEMINI_API_KEY`, not in the
repository. Render supplies `PORT`; do not hard-code it or create a Static Site.
Free services sleep after 15 idle minutes and can take about one minute to wake.
Check shared workspace limits and open the app before a demo.

For optional Cloud Run instead, follow **`DEPLOY.md`**, one PowerShell command per line. Create the Gemini key
in AI Studio yourself, save it directly in Secret Manager, grant the runtime
service account access to that secret, then deploy with `--set-secrets`.
Never paste the key into chat, a command, GitHub or a frontend file.
The new Node deployment uses **port 8080**, replacing the earlier nginx port 80.

## GitHub and submission

Create an empty **public** GitHub repository named `exam-reader`. From the
extracted folder's parent, one command per line:

```powershell
cd exam-reader
git init
git add .
git commit -m "Exam Reader: context-aware accessibility assistant"
git branch -M main
```

GitHub's new-repository page supplies the commands to connect and push an
existing repository. Run those for your own repository. Use **only `main`**,
commit further changes to that branch and do not create another branch.
The supplied source is far below 10 MB and contains no dependency directory.

Before using one of the two submission attempts, confirm the chosen challenge,
public repository contents, single branch, deployed URL and LinkedIn post URL.
No evaluation score is claimed or guaranteed.
