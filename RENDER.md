# Deploy Exam Reader on Render Free

Use a **Web Service**, not a Static Site. The Gemini endpoint needs the Node
server. This guide uses Render's native Node runtime; you do not need Docker,
Google Cloud billing, event credits or Secret Manager for this route.

Keep the Gemini key in a separate Google AI Studio Free Tier project with no
billing linked. Do not enable paid billing or Prepay. Free-tier content may be
used by Google to improve products, so demo only sample/public questions and
a demo profile. Never send private papers or personal/student data.

## 1. Prepare the GitHub repository on Windows

Extract the ZIP.

Open the extracted `exam-reader` folder in your editor.

Check that `package.json`, `server.js`, `index.html` and `app.js` are directly
inside this folder.

Copy this folder's contents into the root of your existing Exam Reader repository,
replacing the earlier build. Do not copy secrets or a `.env` file.

Open PowerShell in that repository folder.

Run each command on its own line:

```powershell
npm test
npm run check
git status
```

Read the status before staging. It should list only the intended Exam Reader
source/docs/tests, never an API key, `.env`, credential JSON or another project.
Then run each command on its own line:

```powershell
git add .
git commit -m "Add optional Gemini reading aid and Render deployment"
git push origin main
```

If this is a new repository rather than an existing one, follow the GitHub
section in `README.md` to create/connect it first. Do not run `git init` inside
a different project's repository. Keep the submission repository public and
use the `main` branch.

## 2. Create a Render Web Service

Open https://dashboard.render.com/ in your own account.

Click **New**.

Click **Web Service**.

Choose **Git Provider**.

Connect GitHub if it is not already connected.

Select your Exam Reader repository, not Setu.

Set **Name** to an available name such as `exam-reader-nitish`.

Choose an available region close to your users.

Set **Branch** to `main`.

Set **Language** to **Node**, even if the Dockerfile caused auto-detection of Docker.

Leave **Root Directory** blank when `package.json` is at the repository root.

If the repository instead contains an outer `exam-reader` folder with
`package.json` inside it, set **Root Directory** to `exam-reader`.

Set **Build Command** to `npm run check`.

Set **Start Command** to `npm start`.

Select the **Free** instance type.

Do not select a paid instance or add a persistent disk/database.

If asked to upgrade or add payment details, stop and ask before continuing.

## 3. Add server environment variables privately

Expand **Advanced** if the environment-variable fields are not already visible.

Add the environment variable `NODE_VERSION` with value `22`.

Add the environment variable `GEMINI_MODEL` with value `gemini-3.8-flash`.

Add the environment variable `GEMINI_API_KEY`.

Paste your key only into that variable's private **Value** field in Render.

Do not put quotes around the key value.

Do not share a screenshot with the value visible.

Do not add the key to GitHub, a frontend file, a command or chat.

Leave `PORT` unset. Render supplies it, normally `10000`.

Set **Health Check Path** to `/healthz`.

Click **Create Web Service**.

Wait for the build/deploy status to become **Live**.

If the service already exists, select it instead of creating a duplicate.

Open **Environment** in its left menu.

Use **Add Environment Variable** to add/update the values above.

Choose **Save, rebuild, and deploy** after changes, not **Save only**.

Open **Settings** to check Node, build/start commands and `/healthz` if needed.

## 4. Verify the actual service

Open the exact HTTPS `onrender.com` URL that Render gives this service.

Append `/healthz` to that actual URL and open it. It should return
`{"status":"ok"}`. This checks the server, not Gemini credentials or quota.

Return to the app URL.

Click **Try it now**.

Click **Load sample paper**.

Choose a demo reading profile.

Click **Start reading**.

Check the original question and marks.

Expand **Simplify with AI**.

Read the privacy notice.

Tick consent for this one sample question.

Click **Simplify with AI**.

A successful provider response is labelled **Gemini AI rewording**. A result
labelled **Local reading guide** is the offline/error fallback, not proof of
a live Gemini call. If it falls back, check the server environment-variable
names, the key's Free Tier project/quota and the latest deploy status. Do not
upgrade billing or put the key in frontend code to fix it.

Open the submitted GitHub and app URLs in a fresh browser tab before submitting.

## Port and Docker notes

`server.js` already reads `process.env.PORT`, defaults to `8080` locally, and
binds to `0.0.0.0`. No port code change is needed for Render. The automated
server suite checks launch with a supplied port and the `/healthz` response.

The Dockerfile remains available for optional Cloud Run deployment. It sets a
local container default of `8080`; the server still honours a supplied `PORT`.
Use the native Node route above to avoid unnecessary Docker setup here.

## Free-service limits

Render Free web services spin down after 15 minutes without inbound traffic.
The next request can show a loading page for about one minute while the service
wakes. Open the actual app before a live demo and allow it to finish waking;
do not promise instant first load to judges. No automatic keep-alive is added.

Free hours, build minutes and bandwidth are shared at workspace level, so an
existing service such as Setu also matters. Check your workspace's included
usage. Exhausted limits can suspend services/builds, and some overages can be
billed when a payment method exists. The Free instance choice is not a guarantee
that every workspace charge is zero. Do not change to a paid plan without
choosing that cost yourself.

The app stores no papers on the server and does not need a database or disk.
Request counters reset when the process restarts or wakes from sleep; they are
not authentication or an absolute spending cap.

## Optional Cloud Run route

Use `DEPLOY.md` only if you choose Cloud Run instead. It retains the two-project
Gemini/hosting setup and Secret Manager steps. Do not do both hosting routes
just to make this demo work.

## Official references

- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/web-services
- https://render.com/docs/free
- https://render.com/docs/node-version
- https://render.com/docs/configure-environment-variables
- https://render.com/docs/health-checks
