export interface ObservedAction {
  service: string;
  action: string;
  resourceArn: string;
  timestamp: string;
  requestParams?: Record<string, unknown>;
  sourceIp?: string;
  userAgent?: string;
}

export interface CollectionRun {
  runId: string;
  roleArn: string;
  startTime: string;
  endTime: string;
  eventCount: number;
}

export interface PolicyStatement {
  Sid: string;
  Effect: "Allow" | "Deny";
  Action: string[];
  Resource: string[];
  Condition?: Record<string, Record<string, string>>;
}

export interface IAMPolicy {
  Version: "2012-10-17";
  Statement: PolicyStatement[];
}

export interface DriftResult {
  category: "over-permissioned" | "under-permissioned" | "resource-drift" | "stale" | "new-behavior";
  severity: "high" | "medium" | "low";
  action: string;
  detail: string;
}

export interface DriftReport {
  roleArn: string;
  analyzedAt: string;
  totalDrifts: number;
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  drifts: DriftResult[];
}
