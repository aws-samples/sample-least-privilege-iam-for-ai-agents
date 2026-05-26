import {
  CloudTrailClient,
  LookupEventsCommand,
  type Event,
} from "@aws-sdk/client-cloudtrail";
import { ObservedAction } from "../types.js";
import { ObservationStore } from "./store.js";

export interface CollectorOptions {
  roleArn: string;
  days: number;
  region: string;
  includeDataEvents?: boolean;
}

export class LogCollector {
  private client: CloudTrailClient;
  private store: ObservationStore;

  constructor(region: string, store: ObservationStore) {
    this.client = new CloudTrailClient({ region });
    this.store = store;
  }

  async collect(options: CollectorOptions): Promise<{ eventCount: number; runId: string }> {
    const { roleArn, days } = options;
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

    const runId = this.store.startRun(roleArn, startTime.toISOString());
    let eventCount = 0;
    let nextToken: string | undefined;

    do {
      const response = await this.client.send(
        new LookupEventsCommand({
          StartTime: startTime,
          EndTime: endTime,
          LookupAttributes: [
            {
              AttributeKey: "ResourceType",
              AttributeValue: "AWS::IAM::Role",
            },
          ],
          MaxResults: 50,
          NextToken: nextToken,
        })
      );

      const events = response.Events || [];
      for (const event of events) {
        const action = this.parseEvent(event, roleArn);
        if (action) {
          this.store.insertObservationForRole(roleArn, action, runId);
          eventCount++;
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    this.store.completeRun(runId, endTime.toISOString(), eventCount);
    return { eventCount, runId };
  }

  private parseEvent(event: Event, roleArn: string): ObservedAction | null {
    if (!event.CloudTrailEvent) return null;

    const detail = JSON.parse(event.CloudTrailEvent);
    const userIdentity = detail.userIdentity;

    // Filter: only events from the target role
    const eventRoleArn = userIdentity?.arn || userIdentity?.sessionContext?.sessionIssuer?.arn;
    if (!eventRoleArn || !eventRoleArn.includes(roleArn.split("/").pop())) {
      return null;
    }

    const eventSource = detail.eventSource || "";
    const service = eventSource.replace(".amazonaws.com", "");
    const action = detail.eventName;

    if (!service || !action) return null;

    // Extract resource ARN from resources array or construct from request
    const resourceArn = this.extractResourceArn(detail, service);

    return {
      service,
      action,
      resourceArn,
      timestamp: detail.eventTime || event.EventTime?.toISOString() || new Date().toISOString(),
      requestParams: detail.requestParameters,
      sourceIp: detail.sourceIPAddress,
      userAgent: detail.userAgent,
    };
  }

  private extractResourceArn(detail: Record<string, unknown>, service: string): string {
    // Try to get ARN from resources array
    const resources = detail.resources as Array<{ ARN?: string }> | undefined;
    if (resources?.length && resources[0].ARN) {
      return resources[0].ARN;
    }

    // Construct a best-effort ARN from request parameters
    const region = (detail.awsRegion as string) || "*";
    const account = (detail.recipientAccountId as string) || "*";
    return `arn:aws:${service}:${region}:${account}:*`;
  }
}
