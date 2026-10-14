# HowManySeats production watch pilot

Prepared October 13, 2026 for existing PR #6, branch `feature/5-background-watches`.
**State: released and verified; approved pilot enabled.** Initial code is
`7f3354d724d86e212a83b915d09f3dbaeae18b0e`; initial tested production deployment is
`dpl_87m6FBawmHgTwyaccqgRE96Ru3TN`. The maintainer approved the costs, stack update,
scoped service key, PR merge and promotion. Final merge/build identifiers are
recorded in PR #6 and the private manifest. See [the release evidence](production-release-evidence.md).
The original approved end is `2026-10-15T03:17:03.1281272Z` (October 14, 11:17:03 PM Eastern).
The pause/resume procedure was verified without extending this window.

## Selected configuration

The maintainer selected a 24-hour pilot, five-minute refreshes, three globally
active Cineplex watches, six global registration attempts/hour, and two workers.
They selected a scoped service key without changing the AWS account plan.
Only interactive search supports Landmark; background collection is Cineplex.

Reuse `HowManySeatsWatchDemo` in **us-east-2** with profile `project-upgrades`.
Its historical name stays stable to avoid a duplicate stack or replacements.
Use the existing table, queues/DLQ, three Lambda functions, schedule, alarms and
bootstrap. Production records use `production:registry` and `production:watch:*`;
legacy fixture/live demo records remain in their original namespace. Fixture
records therefore cannot be returned or mislabeled as live by the production API.
Existing demo polling stays governed by its unchanged fifteen-minute guard.

The production mode requires explicit live mode, quotas, a five-minute cadence,
concurrency two, Ohio, and a future end date within 24 hours at synthesis. Polling
defaults disabled. No operating window may be renewed without approval.
The same end date goes into Scheduler, every Lambda, the web server and the IAM
write/send policy. At the deadline, scheduled dispatch stops, workers stop
provider work and fence late results, registration stops, and the web key loses
write/send permission. Reads of retained history remain possible until key revocation.

Unchanged ceilings: 48-hour maximum screening lifetime, 24 observations/failures
per watch, 64 refresh jobs, three collection attempts, 30-second fenced leases,
60/120-second retries, seven days of record retention after screening expiry
(asynchronous DynamoDB TTL), one-day refresh queue retention, seven-day DLQ/log
retention, 64 read/256 write request units per second. These are not money caps.

## Hosting and authentication

Verified target: Vercel project `how-many-seats`, team `parsa-bagheris-projects`,
production branch `main`, public domain `howmanyseats.ca`. The CLI login works;
the connector cannot list environment variables, so use the scoped CLI fallback.
Vercel reports an active Hobby plan. OIDC is enabled, but AWS's new-account
organization policy prohibits `iam:*Provider*` operations. Do not enable advanced
features, change plans, or weaken the policy for this release.

CDK adds one IAM service user, no console login and no access key in the template
or outputs. Its policy permits only namespace-scoped DynamoDB GetItem/PutItem and
SendMessage on the refresh queue. Put/send expire at the approved deadline. It
cannot read demo records, consume queues, write the DLQ, invoke Lambda or administer
resources. Lambda uses its existing execution roles.

After approval and successful stack update, create one key for the **user named
by the new stack output**. Capture the result directly into process memory;
never print it, place it in command arguments, commit it, or publish raw outputs.
Transfer the values to Vercel as production-only Secret variables. Discard any
temporary secret file immediately after successful transfer. Record only the
key ID/user privately for rotation and revocation. Static credentials have a
rotation/revocation responsibility; the application does not use a CLI session.

| Vercel production variable | Value/type |
| --- | --- |
| `WATCH_BACKEND` | `aws`, Config |
| `WATCH_MODE` | `live`, Config |
| `WATCH_DEPLOYMENT` | `production`, Config |
| `WATCH_AWS_REGION` | `us-east-2`, Config; overrides unrelated platform region |
| `WATCH_AWS_AUTH` | `service-key`, Config |
| `WATCH_AWS_ACCESS_KEY_ID` | Dedicated service key, Secret |
| `WATCH_AWS_SECRET_ACCESS_KEY` | Dedicated secret, Secret |
| `WATCH_MAX_ACTIVE` | `3`, Config |
| `WATCH_MAX_REGISTRATIONS` | `6`, Config |
| `WATCH_POLLING_END_DATE` | Exact approved ISO UTC end shared with CDK, Config |
| `WATCH_TABLE` | Existing stack table output, private server configuration |
| `WATCH_QUEUE_URL` | Existing stack queue output, private server configuration |
| `WATCH_DLQ_URL` | Existing stack DLQ output, private server configuration |

Do not set these in Preview or `NEXT_PUBLIC_*`. Existing Maps variables are
preserved. Hosted paths explicitly reject SQLite, fixtures and missing scoped
credentials. SDK clients use the named service credentials, ignoring ambient
AWS access keys/session tokens supplied by a developer or Vercel. Do not test
the deployed credential by copying it to the browser or local CLI profile.

## Exact stack diff and preparation checks

Read-only comparison against the deployed stack shows two added resources:
the IAM user and its inline policy. Existing Lambda assets/environments change;
Scheduler receives EndDate; table, queues and log groups receive RETAIN removal
policies. The enabled release also changes Scheduler state to ENABLED. No new
table, queue, Lambda, public endpoint, stack, region, NAT gateway or alarm.
The refresh queue was empty in read-only preflight. The earlier intentionally failed fixture dead letter was privately archived and
removed by its verified individual receipt; the DLQ reported zero remaining
messages. Alarm evaluation can lag cleanup. Never purge an entire queue.

Verified locally: 102 application tests, nine infrastructure-window tests,
typecheck, production build, zero production-dependency audit advisories, demo
synthesis/assertions, and both disabled/enabled production template assertions.
The local two-process replay delivered 24 jobs 48 times, with zero duplicate
history/latest regressions, crash-after-store recovery and stale-worker fencing.
The public AWS/live flow, scheduled observations, real redelivery, CloudWatch
publication and cloud pause/resume were also verified; see the release evidence.
There are remaining development-dependency advisories; no major Tailwind rewrite
was made for this release. Local fixtures do not prove the deployed IAM flow.

## Costs and approval scope

AWS read-only preflight reports FREE/ACTIVE and US$120 remaining credits. This
does not approve usage or guarantee credit eligibility. No plan/account/domain
change is proposed. All estimates below are **USD before free usage/credits**.

The current Ohio public price catalogs quote DynamoDB standard writes $0.625
and reads $0.125 per million units; Lambda $0.20/million requests and
$0.0000166667/GB-second; standard SQS $0.40/million requests; CloudWatch logs
$0.50/GB ingestion, $0.03/GB-month storage, standard alarms $0.10/month and
custom metrics $0.30/month. Published catalogs were checked October 13, 2026.

For a 24-hour pilot assume up to 1,100 unique jobs (864 five-minute slots for
three continuously active watches plus registration/recovery allowance), up
to three attempts per job, a conservative mature 48-KB watch document, bounded
retries, 256-MB Lambda invocations lasting at most 30 seconds, one browser tab
reading three watches every 15 seconds, and modest logs. Expected incremental
pilot usage is approximately **$0.20-$1.00**, including prorated monitoring.
Initial IAM provisioning has no service charge; deployment requests/assets are
small additional usage. Public read traffic, repeated deployment failures or
unexpected contention can increase costs; this range is not a cap or benchmark.

Three idle alarms cost up to $0.30/month plus retained table/log/bootstrap
storage. Four regularly publishing custom metrics add up to $1.20/month;
otherwise metric charges are prorated to publication hours. Each continuously
open tab reading three mature watches adds roughly $0.03/day in DynamoDB reads,
plus existing Vercel usage. Do not enable recurring collection past this pilot.
Vercel Hobby supplies existing hosting; no paid hosting upgrade is proposed.

Sources: [DynamoDB catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/us-east-2/index.json),
[Lambda catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-2/index.json),
[SQS catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/us-east-2/index.json),
[CloudWatch catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-2/index.json),
[Scheduler pricing](https://aws.amazon.com/eventbridge/pricing/),
[AWS managed account policies](https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html),
[Vercel AWS environment behavior](https://vercel.com/docs/environment-variables/reserved-environment-variables).

## Approved release sequence

1. Record reviewed PR/head SHA, current production deployment for rollback,
   stack/account/region identity, credits, queue/DLQ and monitoring baselines
   under the workspace's private AWS evidence area. Verify no user changes.
2. Generate one fresh UTC end date for the approved 24-hour window. Synthesize
   with the explicit context below. Assert the actual template and compare it
   against the same existing stack; do not reuse a stale assembly/end date.

```powershell
$pilotEnd = [DateTime]::UtcNow.AddHours(24).ToString('o')
$pilotContext = @(
  '--context', 'deploymentRegion=us-east-2',
  '--context', 'watchDeployment=production',
  '--context', 'enableLive=true',
  '--context', "pollingEndDate=$pilotEnd",
  '--context', 'refreshMinutes=5',
  '--context', 'maxActive=3',
  '--context', 'maxRegistrations=6',
  '--context', 'workerConcurrency=2'
)
npx cdk synth --profile project-upgrades --output cdk.production.out @pilotContext
npm run infra:verify:production -- cdk.production.out DISABLED
npx cdk diff --app cdk.production.out --profile project-upgrades --no-change-set
```

3. After approval, deploy that disabled production assembly to the existing stack.
   Save private outputs; generate/store the scoped service key. Set only the
   production hosting variables above. Do not activate recurring polling yet.
4. Stage the reviewed website with production variables using
   `vercel deploy --prod --skip-domain` in the linked existing project. Preserve
   deployment protection. Verify AWS/live status and the deployed registration,
   queue, worker, database and response using protected CLI access if necessary.
5. Enable Scheduler via a fresh synthesis with the **same end date** and
   `--context enablePolling=true`; assert ENABLED and the matching IAM/runtime
   deadlines before deploying. No renewal of the approved window is implied.
6. With merge/promotion approval, release PR #6 and the reviewed production
   build. Confirm the final public deployment SHA/build identifiers. Git's
   production integration may create another build after merge; verify that
   actual build before treating the released configuration as established.

## End-to-end acceptance and evidence

- Public API reports AWS/live, accepting registration, and the agreed deadline.
  Register a real future Cineplex screening through normal search; favorite it,
  reload and confirm persistence. Observe a queued refresh, then a later
  scheduled refresh with two different timestamps in visible history.
- Redeliver one **completed real job** through the actual queue within the
  approved pilot. Verify its unique history count stays unchanged, duplicate
  counter advances and the latest observation remains ordered. Do not forge
  future jobs or inject fixtures into production.
- Confirm CloudWatch logs show the real stored refreshes and duplicate
  suppression. Query the success/duration/observation-age metrics; distinguish
  the existing fixture DLQ baseline. Alarms have no notification actions.
- Test pause using the IAM-only `pauseAll` operation and disabling Scheduler;
  confirm registration is rejected and histories remain readable. Resume only
  the selected test watch and approved schedule, with the original deadline.
- Check interactive Cineplex and Landmark search. The existing 185+ theatres
  and 600+ showtimes claims have **not** been independently established by a
  current census/production volume benchmark; do not claim new evidence for them.

Record a redacted note with code/PR SHA, UTC timestamp, website build/deployment,
AWS update identifiers, real/fixture mode, observation timestamps, redelivery,
monitoring, quotas, deadline and final schedule state. Keep resource identifiers,
keys, full AWS responses and raw authentication output out of public commits.
Do not infer sustained availability, load-tested capacity, exactly-once queue
transport or alarm notification delivery from this pilot.

## Pause, rollback and cleanup

Disable the existing schedule while preserving its target and role. Invoke the
stack's IAM-only operations Lambda with `{"action":"pauseAll","paused":true}`.
This stops registrations across hosts and pauses/fences existing watches. The
public API then reports accepting=false and displays retained watches as paused.
Disabling Scheduler alone does not stop immediate registration dispatch or
already queued retries. Never expose pause as an unauthenticated public route.

Resume requires `pauseAll` false, explicit per-watch unpause, and enabling the
same bounded schedule. Do not extend EndDate or change quotas during rollback.
To disable website access, remove/unset WATCH_BACKEND and redeploy the previous
approved production build, or roll back to the recorded deployment. Deactivate
and delete the dedicated service key to revoke it; remove its Vercel Secret
variables. Revoke any exposed key immediately, regardless of the deadline.

The pilot automatically stops collection at its deadline; retained reads and
idle storage/alarms can still cost money. Export needed history privately before
cleanup. Production data/queues/logs have RETAIN removal policies: destroying
the stack does not erase them. Remove only exact application resources after
checking ownership and retention needs. Do not destroy a shared bootstrap stack
or another project's resources. Do not switch to demo mode as a cleanup shortcut.
