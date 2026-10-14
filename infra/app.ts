import { App, CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { LogGroup, RetentionDays, FilterPattern, MetricFilter } from "aws-cdk-lib/aws-logs";
import { Alarm, ComparisonOperator, TreatMissingData, Unit } from "aws-cdk-lib/aws-cloudwatch";
import { PolicyStatement, Role, ServicePrincipal, User } from "aws-cdk-lib/aws-iam";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { resolve } from "node:path";
import { releaseConfiguration } from "./release-configuration";

const app = new App();
const deploymentRegion = app.node.tryGetContext("deploymentRegion") ?? "ca-central-1";
if (typeof deploymentRegion !== "string" || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(deploymentRegion)) throw new Error("Specify a valid deploymentRegion, such as ca-central-1 or us-east-2.");
const stack = new Stack(app, "HowManySeatsWatchDemo", { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: deploymentRegion }, description: "Bounded screening watches; explicit demo and production configurations" });
const configuration = releaseConfiguration(Object.fromEntries(["watchDeployment", "enableLive", "enablePolling", "pollingEndDate", "refreshMinutes", "maxActive", "maxRegistrations", "workerConcurrency"].map((key) => [key, app.node.tryGetContext(key)])));
const production = configuration.stage === "production";
if (production && deploymentRegion !== "us-east-2") throw new Error("The approved production pilot must use the existing us-east-2 resources.");
const removalPolicy = production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
const table = new Table(stack, "WatchTable", { partitionKey: { name: "pk", type: AttributeType.STRING }, billingMode: BillingMode.PAY_PER_REQUEST, maxReadRequestUnits: 64, maxWriteRequestUnits: 256, timeToLiveAttribute: "expiresAt", removalPolicy });
const dlq = new Queue(stack, "RefreshDeadLetters", { retentionPeriod: Duration.days(7), encryption: undefined, removalPolicy });
const queue = new Queue(stack, "RefreshQueue", { visibilityTimeout: Duration.seconds(180), retentionPeriod: Duration.days(1), deadLetterQueue: { queue: dlq, maxReceiveCount: 8 }, removalPolicy });
const environment = { WATCH_BACKEND: "aws", WATCH_MODE: configuration.live ? "live" : "fixture", WATCH_MAX_ACTIVE: String(configuration.active), WATCH_MAX_REGISTRATIONS: String(configuration.registrations), WATCH_TABLE: table.tableName, WATCH_QUEUE_URL: queue.queueUrl, WATCH_DLQ_URL: dlq.queueUrl, WATCH_AWS_REGION: deploymentRegion, ...(production ? { WATCH_DEPLOYMENT: "production", WATCH_POLLING_END_DATE: configuration.operatingEndDate! } : {}) };
if (production) {
  // Service principal has no console login and no key in CloudFormation outputs.
  // Create one access key only after release approval, and store it as Vercel Secrets.
  const webUser = new User(stack, "VercelWatchService");
  const keys = { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["production:registry", "production:watch:*"] } };
  webUser.addToPolicy(new PolicyStatement({ actions: ["dynamodb:GetItem"], resources: [table.tableArn], conditions: keys }));
  // The key cannot publish or mutate after the approved pilot deadline, even
  // if website configuration is changed. Reads remain available until revocation.
  const deadline = { DateLessThan: { "aws:CurrentTime": configuration.operatingEndDate! } };
  webUser.addToPolicy(new PolicyStatement({ actions: ["dynamodb:PutItem"], resources: [table.tableArn], conditions: { ...keys, ...deadline } }));
  webUser.addToPolicy(new PolicyStatement({ actions: ["sqs:SendMessage"], resources: [queue.queueArn], conditions: deadline }));
  new CfnOutput(stack, "VercelWatchServiceUser", { value: webUser.userName });
}
function lambda(id: string, handler: string, timeout: number, concurrency: number) {
  return new NodejsFunction(stack, id, { entry: resolve("src/aws/handlers.ts"), handler, runtime: Runtime.NODEJS_22_X, memorySize: 256, timeout: Duration.seconds(timeout), reservedConcurrentExecutions: concurrency, environment, logGroup: new LogGroup(stack, `${id}Logs`, { retention: RetentionDays.ONE_WEEK, removalPolicy }), bundling: { target: "node22", externalModules: ["node:sqlite"], minify: true } });
}
const worker = lambda("Collector", "collector", 30, configuration.concurrency);
const dispatcher = lambda("Dispatcher", "dispatcher", 30, 1);
const api = lambda("WatchApi", "api", 60, 1);
for (const fn of [worker, dispatcher, api]) table.grant(fn, "dynamodb:GetItem", "dynamodb:PutItem");
queue.grantSendMessages(dispatcher); queue.grantSendMessages(api);
queue.grantConsumeMessages(worker); dlq.grantSendMessages(worker);
worker.addEventSource(new SqsEventSource(queue, { batchSize: 1, reportBatchItemFailures: true, maxConcurrency: 2 }));
const scheduleRole = new Role(stack, "ScheduleRole", { assumedBy: new ServicePrincipal("scheduler.amazonaws.com") });
scheduleRole.addToPolicy(new PolicyStatement({ actions: ["lambda:InvokeFunction"], resources: [dispatcher.functionArn] }));
scheduleRole.addToPolicy(new PolicyStatement({ actions: ["sqs:SendMessage"], resources: [dlq.queueArn] }));
const schedule = new CfnSchedule(stack, "RefreshSchedule", { scheduleExpression: "rate(5 minutes)", ...configuration.schedule, flexibleTimeWindow: { mode: "OFF" }, target: { arn: dispatcher.functionArn, roleArn: scheduleRole.roleArn, retryPolicy: { maximumRetryAttempts: 1, maximumEventAgeInSeconds: 300 }, deadLetterConfig: { arn: dlq.queueArn } } });
const failures = new MetricFilter(stack, "RefreshFailuresMetric", { logGroup: worker.logGroup, filterPattern: FilterPattern.any(FilterPattern.stringValue("$.outcome", "=", "dead"), FilterPattern.stringValue("$.outcome", "=", "retry"), FilterPattern.stringValue("$.outcome", "=", "handler-error")), metricNamespace: "HowManySeats/Watches", metricName: "RefreshFailures", metricValue: "1" });
new MetricFilter(stack, "RefreshSuccessesMetric", { logGroup: worker.logGroup, filterPattern: FilterPattern.stringValue("$.outcome", "=", "stored"), metricNamespace: "HowManySeats/Watches", metricName: "RefreshSuccesses", metricValue: "1" });
for (const [name, field] of [["WorkerDurationMs", "durationMs"], ["ObservationAgeMs", "observationAgeMs"]]) new MetricFilter(stack, name, { logGroup: worker.logGroup, filterPattern: FilterPattern.numberValue(`$.${field}`, ">=", 0), metricNamespace: "HowManySeats/Watches", metricName: name, metricValue: `$.${field}`, unit: Unit.MILLISECONDS });
for (const [id, metric, threshold] of [
  ["QueueAge", queue.metricApproximateAgeOfOldestMessage({ period: Duration.minutes(5) }), 600],
  ["DeadLetters", dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }), 0],
  ["RefreshFailures", failures.metric({ period: Duration.minutes(5), statistic: "Sum" }), 0],
] as const) new Alarm(stack, `${id}Alarm`, { metric, threshold, evaluationPeriods: 1, comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD, treatMissingData: TreatMissingData.NOT_BREACHING });
new CfnOutput(stack, "WatchTableName", { value: table.tableName });
new CfnOutput(stack, "QueueUrl", { value: queue.queueUrl });
new CfnOutput(stack, "DeadLetterQueueUrl", { value: dlq.queueUrl });
new CfnOutput(stack, "ApiFunctionName", { value: api.functionName });
new CfnOutput(stack, "DispatcherFunctionName", { value: dispatcher.functionName });
new CfnOutput(stack, "ScheduleName", { value: schedule.ref });
