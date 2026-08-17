// AgentGuard ObservationCollector Lambda
//
// Receives "AWS API Call via CloudTrail" events from EventBridge, filters by the
// target agent role, and emits a normalized observation record to the log stream.
// In production, replace the console.log sink with a write to S3 or DynamoDB.
//
// This is sample code for non-production usage.
"use strict";

/**
 * @param {{ detail?: any }} event EventBridge event wrapping a CloudTrail record
 */
exports.handler = async (event) => {
  const detail = (event && event.detail) || {};
  const userArn =
    (detail.userIdentity && detail.userIdentity.arn) || "";

  const targetRoleName = process.env.TARGET_ROLE_NAME || "";
  if (!targetRoleName || !userArn.includes(targetRoleName)) {
    return { statusCode: 200, body: "skipped" };
  }

  const observation = {
    service: (detail.eventSource || "").replace(".amazonaws.com", ""),
    action: detail.eventName || "",
    resource:
      (detail.resources && detail.resources[0] && detail.resources[0].ARN) ||
      "*",
    timestamp: detail.eventTime || new Date().toISOString(),
  };

  // Sink: replace with S3 PutObject or DynamoDB PutItem in production.
  console.log(JSON.stringify(observation));

  return { statusCode: 200, body: "processed" };
};
