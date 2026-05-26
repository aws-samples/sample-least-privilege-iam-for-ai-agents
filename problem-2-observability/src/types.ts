export interface AgentTrace {
  traceId: string;
  sessionId: string;
  roleArn: string;
  startTime: string;
  endTime?: string;
  status: "complete" | "failed" | "timeout" | "in-progress";
  totalTokens: number;
  totalLatencyMs: number;
  steps: TraceStep[];
  coherenceScore?: number;
  metadata: Record<string, string>;
}

export interface TraceStep {
  stepId: string;
  parentStepId?: string;
  type: "llm-call" | "tool-call" | "decision" | "state-transition";
  timestamp: string;
  durationMs: number;
  input: RedactedContent;
  output: RedactedContent;
  reasoning?: string;
  confidence?: number;
  tokenCount: number;
  error?: string;
}

export interface RedactedContent {
  raw?: string;
  summary: string;
  tokenCount: number;
  redactions: string[];
}

export interface AnalysisResult {
  traceId: string;
  coherenceScore: number;
  loopsDetected: LoopInfo[];
  hallucinations: HallucinationInfo[];
  criticalPath: string[];  // stepIds
  totalCost: CostEstimate;
}

export interface LoopInfo {
  stepIds: string[];
  pattern: string;
  wastedTokens: number;
}

export interface HallucinationInfo {
  stepId: string;
  claim: string;
  evidence: string;
  severity: "critical" | "minor";
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: "loop" | "high-latency" | "token-budget" | "tool-failure" | "low-coherence" | "confidence-drop";
  threshold: number;
  action: "sns" | "cloudwatch" | "log";
  enabled: boolean;
}

export interface DiffResult {
  divergenceStep: number;
  traceA: { stepCount: number; totalTokens: number; path: string[] };
  traceB: { stepCount: number; totalTokens: number; path: string[] };
  differences: StepDiff[];
}

export interface StepDiff {
  stepIndex: number;
  status: "equal" | "different" | "added" | "removed";
  stepA?: TraceStep;
  stepB?: TraceStep;
}
