import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export interface AgenticIamStackProps extends cdk.StackProps {
  /** The agent role ARN to monitor */
  agentRoleArn: string;
  /** Observation window in days */
  observationDays?: number;
}

/**
 * AgenticIamStack deploys the observation pipeline that captures an AI agent's
 * API calls via CloudTrail, filters them by the agent role ARN with EventBridge,
 * and forwards them to a collector Lambda.
 *
 * Security posture (matches the pattern's stated Security Considerations):
 *  - All S3 buckets use SSE-S3 encryption, block all public access, and enforce SSL.
 *  - The CloudTrail bucket has server access logging enabled to a dedicated log bucket.
 *  - The collector Lambda has read-only CloudTrail access.
 *
 * NOTE: This is sample code for non-production usage. Work with your security and
 * legal teams to meet your organizational security, regulatory, and compliance
 * requirements before deployment.
 */
export class AgenticIamStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgenticIamStackProps) {
    super(scope, id, props);

    const { agentRoleArn, observationDays = 7 } = props;
    const roleName = agentRoleArn.split("/").pop()!;

    // Dedicated bucket to receive S3 server access logs. Encrypted, private,
    // SSL-enforced. Access logging is not enabled on the log bucket itself to
    // avoid a recursive logging loop (standard practice).
    const accessLogBucket = new s3.Bucket(this, "AccessLogBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
    });

    // S3 bucket for CloudTrail logs. Encryption at rest (SSE-S3), all public
    // access blocked, SSL enforced in transit, and server access logging enabled.
    const trailBucket = new s3.Bucket(this, "TrailBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: accessLogBucket,
      serverAccessLogsPrefix: "trail-bucket-access-logs/",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: cdk.Duration.days(observationDays * 2) }],
    });

    // CloudTrail trail (if not already enabled)
    new cloudtrail.Trail(this, "AgentTrail", {
      bucket: trailBucket,
      trailName: `agentic-iam-trail-${roleName}`,
      sendToCloudWatchLogs: true,
      encryptionKey: undefined, // SSE-S3 on the bucket; use a CMK for stricter control
    });

    // Lambda: Collector function. Handler code is packaged from ./lambda rather
    // than inlined, so it can be linted and scanned as source.
    const collectorFn = new lambda.Function(this, "CollectorFn", {
      // Node.js 20.x is an actively supported AWS Lambda LTS runtime and matches
      // the runtime documented throughout this pattern. See AwsSolutions-L1
      // suppression below for rationale.
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(`${__dirname}/../lambda/collector`),
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 10,
      environment: {
        AGENT_ROLE_ARN: agentRoleArn,
        OBSERVATION_DAYS: String(observationDays),
        TARGET_ROLE_NAME: roleName,
      },
    });

    // Grant CloudTrail read access to the collector.
    // cloudtrail:LookupEvents does not support resource-level permissions, so
    // "*" is required by the service. See the CloudTrail service authorization
    // reference. This is read-only and does not expose data-plane access.
    collectorFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "CloudTrailLookupReadOnly",
        actions: ["cloudtrail:LookupEvents"],
        resources: ["*"],
      })
    );

    // EventBridge rule: capture API calls from the agent role
    const rule = new events.Rule(this, "AgentApiCallRule", {
      eventPattern: {
        source: ["aws.cloudtrail"],
        detailType: ["AWS API Call via CloudTrail"],
        detail: {
          userIdentity: {
            arn: [{ prefix: agentRoleArn }],
          },
        },
      },
    });

    rule.addTarget(new targets.LambdaFunction(collectorFn));

    // IAM role for the CLI tool itself (read-only).
    const toolRole = new iam.Role(this, "AgenticIamToolRole", {
      assumedBy: new iam.AccountPrincipal(this.account),
      roleName: "agentic-iam-tool-role",
      description:
        "Read-only role used by the agentic-iam CLI to look up CloudTrail events and read IAM policies.",
    });

    // CloudTrail lookup APIs do not support resource-level scoping; "*" is
    // required by the service for these read-only actions.
    toolRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CloudTrailReadAccess",
        actions: ["cloudtrail:LookupEvents", "cloudtrail:GetTrailStatus"],
        resources: ["*"],
      })
    );

    // IAM read actions used to fetch the target role's current policies for
    // drift detection. These are read-only and scoped to this account's roles
    // and policies.
    toolRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "IAMReadAccess",
        actions: [
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListAttachedRolePolicies",
          "iam:ListRolePolicies",
          "iam:GetRolePolicy",
        ],
        resources: [
          `arn:${this.partition}:iam::${this.account}:role/*`,
          `arn:${this.partition}:iam::${this.account}:policy/*`,
        ],
      })
    );

    // iam:SimulateCustomPolicy evaluates policy documents passed in as strings
    // (custom mode) and does not act on a specific account resource, so it
    // cannot be scoped and requires Resource "*". It is read-only and returns
    // no account data.
    toolRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "IAMPolicySimulation",
        actions: ["iam:SimulateCustomPolicy"],
        resources: ["*"],
      })
    );

    // Outputs
    new cdk.CfnOutput(this, "ToolRoleArn", { value: toolRole.roleArn });
    new cdk.CfnOutput(this, "TrailBucketName", { value: trailBucket.bucketName });
    new cdk.CfnOutput(this, "CollectorFunctionName", {
      value: collectorFn.functionName,
    });

    // ---------------------------------------------------------------------
    // cdk-nag suppressions — each documented with evidence per the PCSR
    // requirement for transparency on wildcard permissions.
    // ---------------------------------------------------------------------

    // Collector Lambda: default execution role uses the AWS-managed
    // AWSLambdaBasicExecutionRole (CloudWatch Logs only) that CDK attaches by
    // default, and cloudtrail:LookupEvents which the service does not support
    // at resource level.
    NagSuppressions.addResourceSuppressions(
      collectorFn,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWSLambdaBasicExecutionRole grants only CloudWatch Logs write access for the function's own log group. It is the standard, least-privilege managed policy for basic Lambda logging.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "cloudtrail:LookupEvents does not support resource-level permissions and requires Resource '*' per the AWS service authorization reference. The action is read-only and returns event metadata only.",
          appliesTo: ["Resource::*"],
        },
        {
          id: "AwsSolutions-L1",
          reason:
            "Node.js 20.x is an actively supported AWS Lambda LTS runtime (not deprecated) and is the runtime documented consistently throughout this pattern. Sample code; consumers can bump to the latest runtime for production.",
        },
      ],
      true
    );

    // CLI tool role: read-only CloudTrail lookups (service requires '*'),
    // account-scoped IAM read wildcards, and SimulateCustomPolicy (custom mode
    // evaluates passed-in strings and cannot be resource-scoped).
    NagSuppressions.addResourceSuppressions(
      toolRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "cloudtrail:LookupEvents / GetTrailStatus and iam:SimulateCustomPolicy do not support resource-level scoping and require Resource '*' per the AWS service authorization reference. All actions are read-only.",
          appliesTo: ["Resource::*"],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "IAM read actions (GetPolicy, GetPolicyVersion, ListAttachedRolePolicies, ListRolePolicies, GetRolePolicy) are intentionally scoped to this account's roles and policies to allow drift detection to read the target agent role's attached and inline policies. Read-only; no write or privilege-escalation actions are granted.",
          appliesTo: [
            `Resource::arn:<AWS::Partition>:iam::${this.account}:role/*`,
            `Resource::arn:<AWS::Partition>:iam::${this.account}:policy/*`,
          ],
        },
      ],
      true
    );
  }
}
