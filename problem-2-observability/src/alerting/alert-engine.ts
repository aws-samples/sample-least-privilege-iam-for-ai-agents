import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { AgentTrace, AnalysisResult, AlertRule } from "../types.js";

const DEFAULT_RULES: AlertRule[] = [
  { id: "loop", name: "Reasoning Loop", condition: "loop", threshold: 3, action: "sns", enabled: true },
  { id: "latency", name: "High Latency", condition: "high-latency", threshold: 30000, action: "cloudwatch", enabled: true },
  { id: "tokens", name: "Token Budget", condition: "token-budget", threshold: 5000, action: "sns", enabled: true },
  { id: "tool-fail", name: "Tool Failure Ignored", condition: "tool-failure", threshold: 1, action: "cloudwatch", enabled: true },
  { id: "coherence", name: "Low Coherence", condition: "low-coherence", threshold: 0.5, action: "sns", enabled: true },
  { id: "confidence", name: "Confidence Drop", condition: "confidence-drop", threshold: 0.3, action: "cloudwatch", enabled: true },
];

export class AlertEngine {
  private cwClient: CloudWatchClient;
  private snsClient: SNSClient;
  private rules: AlertRule[];
  private snsTopicArn?: string;

  constructor(region: string, snsTopicArn?: string, rules?: AlertRule[]) {
    this.cwClient = new CloudWatchClient({ region });
    this.snsClient = new SNSClient({ region });
    this.rules = rules || DEFAULT_RULES;
    this.snsTopicArn = snsTopicArn;
  }

  async evaluate(trace: AgentTrace, analysis: AnalysisResult): Promise<string[]> {
    const triggered: string[] = [];

    for (const rule of this.rules.filter((r) => r.enabled)) {
      const shouldAlert = this.checkRule(rule, trace, analysis);
      if (shouldAlert) {
        triggered.push(rule.name);
        await this.fireAlert(rule, trace, analysis);
      }
    }

    return triggered;
  }

  private checkRule(rule: AlertRule, trace: AgentTrace, analysis: AnalysisResult): boolean {
    switch (rule.condition) {
      case "loop":
        return analysis.loopsDetected.length > 0;
      case "high-latency":
        return trace.totalLatencyMs > rule.threshold;
      case "token-budget":
        return trace.totalTokens > rule.threshold;
      case "tool-failure": {
        const failedTools = trace.steps.filter((s) => s.type === "tool-call" && s.error);
        return failedTools.length >= rule.threshold;
      }
      case "low-coherence":
        return analysis.coherenceScore < rule.threshold;
      case "confidence-drop": {
        for (let i = 1; i < trace.steps.length; i++) {
          const prev = trace.steps[i - 1].confidence;
          const curr = trace.steps[i].confidence;
          if (prev !== undefined && curr !== undefined && prev - curr > rule.threshold) {
            return true;
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  private async fireAlert(rule: AlertRule, trace: AgentTrace, analysis: AnalysisResult): Promise<void> {
    if (rule.action === "cloudwatch") {
      await this.cwClient.send(new PutMetricDataCommand({
        Namespace: "AgentTracer",
        MetricData: [{
          MetricName: rule.name.replace(/\s+/g, ""),
          Value: 1,
          Unit: "Count",
          Dimensions: [
            { Name: "TraceId", Value: trace.traceId },
            { Name: "RoleArn", Value: trace.roleArn },
          ],
        }],
      }));
    }

    if (rule.action === "sns" && this.snsTopicArn) {
      await this.snsClient.send(new PublishCommand({
        TopicArn: this.snsTopicArn,
        Subject: `[AgentTracer] ${rule.name} Alert`,
        Message: JSON.stringify({
          rule: rule.name,
          traceId: trace.traceId,
          sessionId: trace.sessionId,
          roleArn: trace.roleArn,
          coherenceScore: analysis.coherenceScore,
          totalTokens: trace.totalTokens,
          totalLatencyMs: trace.totalLatencyMs,
          loopsDetected: analysis.loopsDetected.length,
          timestamp: new Date().toISOString(),
        }, null, 2),
      }));
    }
  }

  getRules(): AlertRule[] {
    return this.rules;
  }

  updateRule(ruleId: string, updates: Partial<AlertRule>): void {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (rule) Object.assign(rule, updates);
  }
}
