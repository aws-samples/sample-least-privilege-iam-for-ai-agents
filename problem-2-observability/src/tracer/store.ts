import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AgentTrace, TraceStep } from "../types.js";

const TABLE_NAME = "agent-traces";
const TTL_DAYS = 30;

export class TraceStore {
  private docClient: DynamoDBDocumentClient;

  constructor(region: string) {
    const client = new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  async saveTrace(trace: AgentTrace): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60;

    // Save trace metadata
    await this.docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        traceId: trace.traceId,
        stepId: "METADATA",
        sessionId: trace.sessionId,
        roleArn: trace.roleArn,
        startTime: trace.startTime,
        endTime: trace.endTime,
        status: trace.status,
        totalTokens: trace.totalTokens,
        totalLatencyMs: trace.totalLatencyMs,
        stepCount: trace.steps.length,
        coherenceScore: trace.coherenceScore,
        metadata: trace.metadata,
        expiresAt: ttl,
      },
    }));

    // Save each step
    for (const step of trace.steps) {
      await this.docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          traceId: trace.traceId,
          stepId: step.stepId,
          ...step,
          expiresAt: ttl,
        },
      }));
    }
  }

  async getTrace(traceId: string): Promise<AgentTrace | null> {
    const result = await this.docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "traceId = :tid",
      ExpressionAttributeValues: { ":tid": traceId },
    }));

    if (!result.Items || result.Items.length === 0) return null;

    const metadata = result.Items.find((i) => i.stepId === "METADATA");
    if (!metadata) return null;

    const steps = result.Items
      .filter((i) => i.stepId !== "METADATA")
      .sort((a, b) => (a.timestamp as string).localeCompare(b.timestamp as string)) as unknown as TraceStep[];

    return {
      traceId: metadata.traceId as string,
      sessionId: metadata.sessionId as string,
      roleArn: metadata.roleArn as string,
      startTime: metadata.startTime as string,
      endTime: metadata.endTime as string,
      status: metadata.status as AgentTrace["status"],
      totalTokens: metadata.totalTokens as number,
      totalLatencyMs: metadata.totalLatencyMs as number,
      coherenceScore: metadata.coherenceScore as number | undefined,
      steps,
      metadata: (metadata.metadata as Record<string, string>) || {},
    };
  }

  async getTracesBySession(sessionId: string): Promise<AgentTrace[]> {
    const result = await this.docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "sessionId-startTime-index",
      KeyConditionExpression: "sessionId = :sid",
      ExpressionAttributeValues: { ":sid": sessionId },
    }));

    return (result.Items || []).map((item) => ({
      traceId: item.traceId as string,
      sessionId: item.sessionId as string,
      roleArn: item.roleArn as string,
      startTime: item.startTime as string,
      endTime: item.endTime as string,
      status: item.status as AgentTrace["status"],
      totalTokens: item.totalTokens as number,
      totalLatencyMs: item.totalLatencyMs as number,
      steps: [],
      metadata: {},
    }));
  }

  async getRecentTraces(roleArn: string, limit: number): Promise<AgentTrace[]> {
    const result = await this.docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "roleArn-startTime-index",
      KeyConditionExpression: "roleArn = :arn",
      ExpressionAttributeValues: { ":arn": roleArn },
      ScanIndexForward: false,
      Limit: limit,
    }));

    return (result.Items || []).map((item) => ({
      traceId: item.traceId as string,
      sessionId: item.sessionId as string,
      roleArn: item.roleArn as string,
      startTime: item.startTime as string,
      endTime: item.endTime as string,
      status: item.status as AgentTrace["status"],
      totalTokens: item.totalTokens as number,
      totalLatencyMs: item.totalLatencyMs as number,
      steps: [],
      metadata: {},
    }));
  }
}
