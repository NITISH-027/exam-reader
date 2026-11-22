# Validation

## Fast checks, no dependencies

Node.js 22.x:

```powershell
npm test
npm run check
```

The command runs both the core/static suite and the mocked provider/HTTP suite, and exits nonzero if any check fails. No test needs a real Gemini key. It tests:

- Question numbering formats, line continuations, marks, empty input and Unicode preservation.
- Chunk boundaries, case preservation, punctuation and reconstruction of the original word.
- Every profile, long-word and dense-paper rules, explanations and safe fallback choices.
- Settings enums, ranges, invalid types, inherited keys and unknown profiles.
- Storage round-trips, invalid JSON, oversized records, denied access and exclusion of paper text.
- Input size boundaries and direct-parser enforcement.
- Cached speech token indexing, including empty and boundary cases.
- Static security contracts, CSP, labels and skip-link presence.

## Optional automated browser tests

The app and unit tests have no dependencies. This optional development-only
suite uses Python and Playwright to test actual browser behavior:

```powershell
python -m pip install playwright
python -m playwright install chromium
python browser-tests.py
python ai-browser-tests.py
```

It starts its own local HTTP server and checks all three screens, selected
profiles, lilac theme preservation, card-only tinting, local-voice fallback,
word highlighting, question navigation, bookmarking, keyboard popover focus,
keyboard ruler movement, inert pasted markup, input rejection, storage recovery,
mobile overflow, reduced motion, external requests and JavaScript errors.

## Manual demo checklist

- Open locally, load the sample and select Dyslexia. The selected chip is purple
  with a check. The page stays lilac; the reading card alone is cream.
- Try Low vision, dark mode and yellow-on-black. Check readability on the actual display.
- Use Tab, Shift+Tab, Enter and Space on controls. Use Escape to leave a tool popup.
- Navigate with Left/Right. In list view with the ruler on, try Alt+Up/Down.
- Press Read aloud once on the laptop used for the demo. Check the installed local
  voice if available, or the visible fallback if none is available.
- Try at a narrow phone width and confirm Home, Paste and all seven tools remain reachable.
- Test the hosted URL after deployment, including a page refresh. Container deployment
  and device-specific audio are separate from the local automated tests.

Automated checks demonstrate the covered behaviors. They are not a claim of a
complete accessibility conformance audit or an evaluation score.

## Gemini and server coverage

`npm test` includes mocked provider success, denied access, network failures,
timeouts, malformed/empty/oversized/truncated responses, no-key fallback,
request validation, key non-disclosure, response filtering, concurrency and
rate-limit behavior. Local HTTP tests cover security headers, same-origin
checks, content type, JSON/body limits, method restrictions, static allowlisting,
and real child-process startup with a supplied PORT and /healthz response. The local guide also preserves decimal values intact.

The separate AI browser suite verifies no call before consent plus a click,
only the selected question/profile in the payload, original/marks preservation,
text-only output, browser-memory reuse, new-question consent reset, network,
no-key and offline fallback. Success responses are MOCKED. Passing these tests
is not evidence that a live Gemini key/model or Cloud Run deployment worked.
Use the final verification steps in `DEPLOY.md` for that check.
