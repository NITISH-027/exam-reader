# Implementation references

Checked against official documentation on 22 November 2026. These are API and
setup references, not evidence that this project's deployment has run.

- https://ai.google.dev/api/generate-content
  REST generateContent request/response structure, system instructions and generation configuration.
- https://ai.google.dev/api
  Gemini REST base URL and x-goog-api-key header authentication.
- https://ai.google.dev/gemini-api/docs/models
  Model catalogue, including the configured gemini-3.8-flash model.
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
  Current model details. A project's actual access/quota still needs testing with its own key.
- https://ai.google.dev/gemini-api/docs/api-key
  Create a key in AI Studio; keep it confidential and server-side.
- https://ai.google.dev/gemini-api/docs/pricing
  Usage tiers and costs. No assumption that an operator's usage is free.
- https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy
  Source deployment, port, service account, environment secrets and instance/concurrency flags.
- https://docs.cloud.google.com/run/docs/configuring/services/secrets
  Supply a Secret Manager secret as a server environment variable, with runtime access permission.
- https://cloud.google.com/secret-manager/docs/manage-access-to-secrets
  Secret Manager Secret Accessor role and secret-scoped IAM binding.

- https://aistudio.google.com/docs/whats-new-gemini-3.8
  Supports low thinking effort; minimal is not supported on the default model.
- https://ai.google.dev/api/generate-content#ThinkingConfig
  generateContent thinkingConfig structure; version-specific control is sent only for Gemini 3+.

- https://aistudio.google.com/docs/billing
  Keys inherit their project's tier; an unbilled project remains Free Tier, subject to eligibility and quota.
- https://ai.google.dev/gemini-api/docs/pricing
  The configured model has a Free Tier; that tier permits product-improvement use of content.

- https://docs.cloud.google.com/run/docs/deploying-source-code
  Default source-build service account and Cloud Run Builder role.

- https://render.com/docs/web-services
  Native Node service fields, host binding and provider-supplied PORT.
- https://render.com/docs/free
  Free instance selection, idle spin-down, cold starts and shared workspace limits.
- https://render.com/docs/node-version
  Node runtime selection and bounded engine ranges.
- https://render.com/docs/configure-environment-variables
  Private server environment-variable setup and deploy/save behavior.
- https://render.com/docs/health-checks
  HTTP health-check configuration and success codes.
