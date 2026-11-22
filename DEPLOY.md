# Optional: deploy Exam Reader to Cloud Run

For Render Free instead, use `RENDER.md`. Choose one hosting route.

You do these steps in your own accounts. Do not send the API key to anyone or
paste it into a terminal command, source file, LinkedIn post or GitHub.
Use TWO projects: an unbilled Gemini Free Tier project for the key, and the
Google Cloud trial/event-credit project for Cloud Run and Secret Manager.
Do not link billing or set up Prepay for the Gemini project. Verify the event
credit is active in the Cloud Run project before deploying. Cloud resources
consume that project's credit/quota; request limits are not a billing cap.

## 1. Prepare your accounts

- Install Node.js 22.x and the Google Cloud CLI if needed.
- Have an event-credit/trial Google Cloud project for hosting. Check its credit
  and billing status yourself; do not assume an event code was applied.
- Separately create/select a Gemini Free Tier project with NO billing account
  linked. Verify its Free Tier status in AI Studio.
- Open https://aistudio.google.com/api-keys and create a Gemini API key in your
  unbilled Gemini project, not the hosting project. Record its project ID as
  YOUR_GEMINI_FREE_PROJECT_ID. Copy the key only for the private Secret Manager entry in step 3.
  If access, project creation or API use is restricted, follow the account's
  prompts that do not upgrade billing. If payment or Prepay is required, stop
  and use the local fallback; do not upgrade or put a key into the frontend.
- In the extracted `exam-reader` folder, run `npm test` to check the source.

Free-tier Gemini inputs/outputs may be used by Google to improve products.
Use only the built-in sample, public questions and a demo reading profile.
Do not send private papers, confidential content or personal/student data.

## 2. Prepare the HOSTING Google Cloud project

Open PowerShell. Replace the two project ID placeholders. The Gemini ID is recorded for checking
the key in AI Studio; the gcloud hosting commands target only the hosting ID. One command per line:

```powershell
gcloud auth login
$GeminiProjectId = "YOUR_GEMINI_FREE_PROJECT_ID"
$CloudRunProjectId = "YOUR_EVENT_CREDIT_PROJECT_ID"
gcloud config set project $CloudRunProjectId
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
$ProjectNumber = gcloud projects describe $CloudRunProjectId --format="value(projectNumber)"
$BuildAccount = "$ProjectNumber-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding $CloudRunProjectId --member="serviceAccount:$BuildAccount" --role="roles/run.builder"
gcloud iam service-accounts create exam-reader-runtime --display-name="Exam Reader runtime"
$RuntimeAccount = "exam-reader-runtime@$CloudRunProjectId.iam.gserviceaccount.com"
```

The builder role is for the default Cloud Build account, separate from the
restricted runtime account. On a new project, allow a few minutes for the role
to propagate. If your organisation uses a different build account, have its
admin apply the builder role to that account instead.

If the runtime service account already exists, keep it and continue to the
variable assignment. Do not create a second account just to bypass an error.
If an API-enablement or IAM permission step fails, fix that project permission
before deployment.

## 3. Put the key in Secret Manager, not in a command

In Google Cloud console, select the HOSTING project (YOUR_EVENT_CREDIT_PROJECT_ID), not the Gemini project. The secret value is a private copy of the key from the unbilled Gemini project. Search for **Secret Manager**.
Choose **Create secret**:

- Name: `exam-reader-gemini-key`
- Secret value: paste your Gemini API key privately in this field.
- Create the secret. The first saved value is version **1**.

Do not attach a screenshot showing the secret value. The runtime service
account should be granted access only to this secret, not project-wide secrets.

Then, back in the same PowerShell session:

```powershell
gcloud secrets add-iam-policy-binding exam-reader-gemini-key --member="serviceAccount:$RuntimeAccount" --role="roles/secretmanager.secretAccessor"
```

## 4. Deploy the NEW Node version

From the extracted folder's parent, one command per line:

```powershell
cd exam-reader
gcloud run deploy exam-reader --source . --region asia-south1 --port 8080 --allow-unauthenticated --service-account $RuntimeAccount --set-secrets="GEMINI_API_KEY=exam-reader-gemini-key:1" --set-env-vars="GEMINI_MODEL=gemini-3.8-flash" --min-instances 0 --max-instances 1 --cpu-throttling --concurrency 8 --timeout 30
```

Accept only the expected build/API prompts, not billing upgrades or Prepay. The command prints the service URL
when deployment succeeds. This command contains a SECRET NAME, not the key.
Cloud Run resolves the secret into the server's `GEMINI_API_KEY` environment
variable. The browser never receives it.

The service scales to zero and uses request-based CPU allocation. The Dockerfile uses Node, not nginx. **Port 8080 replaces the old port 80.**
Keep the GitHub repo public, under 10 MB, and on a single `main` branch.

## 5. Verify before submitting

1. Open the service URL and load the sample paper.
2. Select a reader profile and start reading. Confirm the original and marks.
3. Expand **Simplify with AI**. Read the notice, allow this one question, then click.
4. A successful provider response is labelled **Gemini AI rewording**. Check it
   against the original. If the title says **Local reading guide**, the Gemini
   call was not completed successfully. Do not describe that result as live AI.
5. For a local result, check the secret name/version, runtime secret-access role,
   Gemini model access, API key validity and the unbilled Gemini project's free quota. Do not put
   a key into the frontend or enable billing/Prepay to fix it. If free quota is
   unavailable, keep the local fallback and ask before changing the plan.
6. Refresh the deployed page and check the repository and LinkedIn URLs before
   using one of the two submission attempts.

For local reading without any cloud setup, open `index.html`. For a local
server without a key, `npm start` still works and returns a local guide.

## After the event

If the public demo is no longer needed, disable its API key or remove the
Cloud Run service in your own console. Runtime request counters are local to
one process, reset on restart and cannot guarantee a spending ceiling.

## Official references

- API-key setup/security: https://ai.google.dev/gemini-api/docs/api-key
- Model catalogue: https://ai.google.dev/gemini-api/docs/models
- Cloud Run deploy options: https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy
- Source-build role: https://docs.cloud.google.com/run/docs/deploying-source-code
- Cloud Run secrets: https://docs.cloud.google.com/run/docs/configuring/services/secrets
- Secret access role: https://cloud.google.com/secret-manager/docs/manage-access-to-secrets
