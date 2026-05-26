import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import { Construct } from "constructs";

interface AgenticIamStackProps extends cdk.StackProps {
  /** The agent role ARN to monitor */
  agentRoleArn: string;
  /** Observation window in days */
  observationDays?: number;
}

export class AgenticIamStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgenticIamStackProps) {
    super(scope, id, props);

    const { agentRoleArn, observationDays = 7 } = props;
    const roleName = agentRoleArn.split("/").pop()!;

    // S3 bucket for CloudTrail logs
    const trailBucket = new s3.Bucket(this, "TrailBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(observationDays * 2) }],
    });

    // CloudTrail trail (if not already enabled)
    new cloudtrail.Trail(this, "AgentTrail", {
      bucket: trailBucket,
      trailName: `agentic-iam-trail-${roleName}`,
      sendToCloudWatchLogs: true,
    });

    // Lambda: Collector function
    const collectorFn = new lambda.Function(this, "CollectorFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
        const { CloudTrailClient, LookupEventsCommand } = require('@aws-sdk/client-cloudtrail');
        exports.handler = async (event) => {
          // Process CloudTrail event from EventBridge
          const detail = event.detail;
          const userArn = detail.userIdentity?.arn || '';
          if (!userArn.includes('${roleName}')) return { statusCode: 200, body: 'skipped' };
          
          // Store observation (in production, write to DynamoDB or S3)
          console.log(JSON.stringify({
            service: detail.eventSource?.replace('.amazonaws.com', ''),
            action: detail.eventName,
            resource: detail.resources?.[0]?.ARN || '*',
            timestamp: detail.eventTime,
          }));
          
          return { statusCode: 200, body: 'processed' };
        };
      `),
      timeout: cdk.Duration.seconds(30),
      environment: {
        AGENT_ROLE_ARN: agentRoleArn,
        OBSERVATION_DAYS: String(observationDays),
      },
    });

    // Grant CloudTrail read access to the collector
    collectorFn.addToRolePolicy(
      new iam.PolicyStatement({
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

    // IAM role for the CLI tool itself (read-only)
    const toolRole = new iam.Role(this, "AgenticIamToolRole", {
      assumedBy: new iam.AccountPrincipal(this.account),
      roleName: "agentic-iam-tool-role",
    });

    toolRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CloudTrailReadAccess",
        actions: ["cloudtrail:LookupEvents", "cloudtrail:GetTrailStatus"],
        resources: ["*"],
      })
    );

    toolRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "IAMReadAccess",
        actions: [
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListAttachedRolePolicies",
          "iam:ListRolePolicies",
          "iam:GetRolePolicy",
          "iam:SimulateCustomPolicy",
        ],
        resources: ["*"],
      })
    );

    // Outputs
    new cdk.CfnOutput(this, "ToolRoleArn", { value: toolRole.roleArn });
    new cdk.CfnOutput(this, "TrailBucketName", { value: trailBucket.bucketName });
    new cdk.CfnOutput(this, "CollectorFunctionName", { value: collectorFn.functionName });
  }
}

// App entry point
const app = new cdk.App();
new AgenticIamStack(app, "AgenticIamStack", {
  agentRoleArn: app.node.tryGetContext("agentRoleArn") || "arn:aws:iam::123456789012:role/MyAgentRole",
  observationDays: parseInt(app.node.tryGetContext("observationDays") || "7"),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
});
