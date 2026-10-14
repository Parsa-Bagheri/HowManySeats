# Production release evidence — prepared

Prepared October 13, 2026. **Not deployed or publicly verified.** Existing PR #6
remains the release vehicle. Exact reviewed release SHA will be recorded with
the deployment; the earlier isolated verification head was `2943ad0`.

- Selected: 24-hour pilot, five-minute cadence, three active watches, six
  registration attempts/hour, concurrency two; scoped server-side IAM key.
- Current cloud inspection: existing Ohio stack UPDATE_COMPLETE, Scheduler
  DISABLED, refresh queue empty; active Free plan and credits verified privately.
  Existing Vercel project is Hobby; watch variables were absent.
- Prepared code rejects hosted SQLite/fixtures, pins AWS calls to Ohio, isolates
  production data, adds end-window and shared-pause enforcement, and limits the
  web credential to production Get/Put plus queue SendMessage. IAM Put/send
  permissions expire with the pilot. No key has been created or disclosed.
- Local verification: 102 application tests, nine infrastructure-window tests,
  typecheck and production build passed. Production dependency audit: zero
  advisories; development dependency advisories remain. Demo synthesis/assertions
  and disabled/enabled production assertions passed. Read-only stack diff:
  existing resources reused, IAM user/policy added, data removal set to RETAIN.
- Two independent local processes: 24 unique jobs, 48 deliveries, zero duplicate
  history/latest regressions; crash-after-store replay preserved one observation;
  expired worker rejected after replacement. These are synthetic local results.
- Local built-app browser: a synthetic screening was favorited through the UI,
  the queued worker stored a timestamped observation, and favorite/history
  survived reload. A malformed map showed an unavailable failure without an
  observation; shared pause stopped registration and kept history readable.
  This does not verify deployed AWS credentials or live cinema
  collection. An existing missing favicon caused a 404 console message.
- Production live observations, cloud redelivery, monitoring results, public
  Cineplex/Landmark regression checks and final schedule status are pending
  cost/release approval and deployment. No current 185+/600+ census or volume
  benchmark was manufactured.

See [release configuration, costs and rollback](production-release.md). Raw AWS
metadata, stack diff and fresh replay outputs are retained in the workspace's
private AWS evidence area, outside this repository.
