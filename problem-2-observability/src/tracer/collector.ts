import { AgentTrace, TraceStep, RedactedContent } from "../types.js";
import { randomUUID } from "crypto";

// PII patterns to redact
const PII_PATTERNS = [
  { name: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone", regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
  { name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "credit-card", regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },
];

export class TraceCollector {
  private currentTrace: AgentTrace | null = null;
  private steps: TraceStep[] = [];
  private onStepCallback?: (step: TraceStep) => void;

  startTrace(sessionId: string, roleArn: string): string {
    const traceId = randomUUID();
    this.currentTrace = {
      traceId,
      sessionId,
      roleArn,
      startTime: new Date().toISOString(),
      status: "in-progress",
      totalTokens: 0,
      totalLatencyMs: 0,
      steps: [],
      metadata: {},
    };
    this.steps = [];
    return traceId;
  }

  recordLLMCall(input: string, output: string, durationMs: number, tokenCount: number, reasoning?: string): string {
    const step = this.createStep("llm-call", input, output, durationMs, tokenCount);
    step.reasoning = reasoning;
    step.confidence = this.estimateConfidence(output);
    this.addStep(step);
    return step.stepId;
  }

  recordToolCall(toolName: string, input: string, output: string, durationMs: number, error?: string): string {
    const step = this.createStep("tool-call", `[${toolName}] ${input}`, output, durationMs, 0);
    step.error = error;
    this.addStep(step);
    return step.stepId;
  }

  recordDecision(reasoning: string, chosenAction: string): string {
    const step = this.createStep("decision", reasoning, chosenAction, 0, 0);
    step.reasoning = reasoning;
    this.addStep(step);
    return step.stepId;
  }

  completeTrace(status: AgentTrace["status"] = "complete"): AgentTrace {
    if (!this.currentTrace) throw new Error("No active trace");

    this.currentTrace.endTime = new Date().toISOString();
    this.currentTrace.status = status;
    this.currentTrace.steps = this.steps;
    this.currentTrace.totalTokens = this.steps.reduce((sum, s) => sum + s.tokenCount, 0);
    this.currentTrace.totalLatencyMs = this.steps.reduce((sum, s) => sum + s.durationMs, 0);

    const trace = this.currentTrace;
    this.currentTrace = null;
    return trace;
  }

  onStep(callback: (step: TraceStep) => void): void {
    this.onStepCallback = callback;
  }

  private createStep(type: TraceStep["type"], input: string, output: string, durationMs: number, tokenCount: number): TraceStep {
    return {
      stepId: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      durationMs,
      input: this.redact(input),
      output: this.redact(output),
      tokenCount,
    };
  }

  private addStep(step: TraceStep): void {
    if (this.steps.length > 0) {
      step.parentStepId = this.steps[this.steps.length - 1].stepId;
    }
    this.steps.push(step);
    this.onStepCallback?.(step);
  }

  private redact(content: string): RedactedContent {
    let redacted = content;
    const redactions: string[] = [];

    for (const pattern of PII_PATTERNS) {
      if (pattern.regex.test(redacted)) {
        redactions.push(pattern.name);
        redacted = redacted.replace(pattern.regex, `[REDACTED:${pattern.name}]`);
      }
      pattern.regex.lastIndex = 0; // reset regex state
    }

    return {
      raw: redactions.length === 0 ? content : undefined,
      summary: redacted.slice(0, 200),
      tokenCount: Math.ceil(content.length / 4), // rough estimate
      redactions,
    };
  }

  private estimateConfidence(output: string): number {
    // Heuristic: hedging language reduces confidence
    const hedges = ["might", "possibly", "I'm not sure", "unclear", "maybe", "I think"];
    const hedgeCount = hedges.filter((h) => output.toLowerCase().includes(h)).length;
    return Math.max(0.3, 1.0 - hedgeCount * 0.15);
  }
}

// Bedrock Agent trace parser
export function parseBedrockTrace(traceEvent: Record<string, unknown>): Partial<TraceStep> {
  const trace = traceEvent as Record<string, Record<string, unknown>>;

  if (trace.orchestrationTrace) {
    const orch = trace.orchestrationTrace;
    if (orch.rationale) {
      return { type: "decision", reasoning: String((orch.rationale as Record<string, unknown>).text || "") };
    }
    if (orch.invocationInput) {
      return { type: "tool-call" };
    }
    if (orch.observation) {
      return { type: "tool-call" };
    }
    if (orch.modelInvocationInput) {
      return { type: "llm-call" };
    }
  }

  return { type: "state-transition" };
}
