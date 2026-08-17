#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { AgenticIamStack } from "../lib/agentic-iam-stack";

const app = new cdk.App();

new AgenticIamStack(app, "AgenticIamStack", {
  agentRoleArn:
    app.node.tryGetContext("agentRoleArn") ||
    "arn:aws:iam::123456789012:role/MyAgentRole",
  observationDays: parseInt(
    app.node.tryGetContext("observationDays") || "7",
    10
  ),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
});

// Run cdk-nag AWS Solutions checks on synth. Findings are printed as
// warnings/errors during `cdk synth`.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
