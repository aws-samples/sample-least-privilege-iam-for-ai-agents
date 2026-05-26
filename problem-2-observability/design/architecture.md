# Problem 2: Agent Reasoning Tracer — Design Document

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Runtime                                  │
│  (Bedrock Agent / LangChain / Custom)                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Instrumentation Layer (SDK Interceptor / Callback)       │   │
│  │  - Wraps LLM calls                                       │   │
│  │  - Wraps tool invocations                                 │   │
│  │  - Captures state transitions                             │   │
│  └──────────────────────────┬───────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────┘
                              │ Trace events (async)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 1: Trace Collector                             │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Event Buffer    │→ │ Trace Assembler  │→ │ DynamoDB      │  │
│  │ (in-memory ring)│  │ (correlate steps)│  │ (persistent)  │  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Complete traces
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 2: Reasoning Analyzer                          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Step Parser     │→ │ Coherence Scorer │→ │ Loop Detector │  │
│  │ (extract logic) │  │ (NLI-based)      │  │ (pattern match)│  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Analyzed traces
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 3: Visualization & Alerting                    │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ DAG Renderer    │  │ Waterfall View   │  │ Alert Engine  │  │
│  │ (terminal)      │  │ (timing)         │  │ (CW + SNS)   │  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 4: Self-Update                                 │
│  ┌─────────────────┐  ┌──────────────────┐                     │
│  │ Format Detector │→ │ Parser Registry  │                     │
│  │ (version check) │  │ (hot-reload)     │                     │
│  └─────────────────┘  └──────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Data Model

### Trace Structure

```typescript
interface AgentTrace {
  traceId: string;
  sessionId: string;
  roleArn: string;
  startTime: string;
  endTime: string;
  status: "complete" | "failed" | "timeout" | "in-progress";
  totalTokens: number;
  totalLatencyMs: number;
  steps: TraceStep[];
  metadata: Record<string, string>;
}

interface TraceStep {
  stepId: string;
  parentStepId?: string;  // for nested reasoning
  type: "llm-call" | "tool-call" | "decision" | "state-transition";
  timestamp: string;
  durationMs: number;
  input: RedactedContent;
  output: RedactedContent;
  reasoning?: string;       // extracted reasoning text
  confidence?: number;      // 0-1 score
  tokenCount: number;
  error?: string;
}

interface RedactedContent {
  raw?: string;            // only if PII-free or encryption enabled
  summary: string;         // always available
  tokenCount: number;
  redactions: string[];    // list of redacted fields
}
```

### DynamoDB Schema

```
Table: agent-traces
  PK: traceId (String)
  SK: stepId (String)  — "METADATA" for trace-level data
  GSI1: sessionId + startTime (for session lookup)
  GSI2: roleArn + startTime (for role-based queries)
  TTL: expiresAt (Number, epoch seconds)
```

## 3. Component Design

### 3.1 Instrumentation Layer

**Bedrock Agent Integration**:
```typescript
// Wraps InvokeAgentCommand to capture trace
const response = await bedrockClient.send(new InvokeAgentCommand({
  agentId, agentAliasId, sessionId, inputText,
  enableTrace: true,  // Critical: enables trace output
}));

// Parse trace from response stream
for await (const event of response.completion) {
  if (event.trace) {
    tracer.recordStep(event.trace);
  }
}
```

**LangChain Integration**:
```typescript
class AgentTracerCallback extends BaseCallbackHandler {
  handleLLMStart(llm, prompts) { /* record step */ }
  handleLLMEnd(output) { /* record response */ }
  handleToolStart(tool, input) { /* record tool call */ }
  handleToolEnd(output) { /* record tool response */ }
  handleAgentAction(action) { /* record decision */ }
}
```

### 3.2 Reasoning Analyzer

**Coherence Scoring Algorithm**:
```
For each consecutive pair of steps (N, N+1):
1. Extract the stated reasoning/conclusion from step N
2. Extract the input/premise of step N+1
3. Score logical connection:
   - Direct reference to previous output → 1.0
   - Semantic similarity > 0.8 → 0.8
   - Weak connection → 0.5
   - No connection (potential hallucination) → 0.2
   - Contradiction → 0.0
4. Overall trace coherence = mean of all pair scores
```

**Loop Detection**:
```
1. Hash each step's (type, tool_name, input_summary)
2. Maintain sliding window of last 10 step hashes
3. If same hash appears 3+ times → flag as loop
4. Calculate loop cost (tokens wasted in repeated steps)
```

**Hallucination Detection**:
```
1. For each tool-call → llm-response pair:
   a. Extract factual claims from LLM response
   b. Compare against actual tool output
   c. Flag claims not supported by tool output
2. Severity: informational (minor embellishment) vs critical (contradicts data)
```

### 3.3 Terminal Visualization

**DAG View** (trace command):
```
┌─ Trace: abc-123 ─────────────────────────────────────────┐
│                                                           │
│  [INPUT] "What's the order status for #12345?"           │
│     │                                                     │
│     ▼                                                     │
│  [LLM] Reasoning: Need to look up order → tool call      │
│     │  tokens: 150 | latency: 800ms | confidence: 0.95   │
│     ▼                                                     │
│  [TOOL] dynamodb:GetItem → {status: "shipped", ...}      │
│     │  latency: 45ms                                      │
│     ▼                                                     │
│  [LLM] Reasoning: Order is shipped, compose response     │
│     │  tokens: 200 | latency: 600ms | confidence: 0.98   │
│     ▼                                                     │
│  [OUTPUT] "Your order #12345 has been shipped..."         │
│                                                           │
│  Total: 350 tokens | 1,445ms | Coherence: 0.97           │
└───────────────────────────────────────────────────────────┘
```

**Waterfall View** (timing):
```
Step              0ms    500ms   1000ms  1500ms
─────────────────────────────────────────────────
LLM Call 1       ████████░░░░░░░░░░░░░░░░░░░░░░  800ms
Tool: DynamoDB   ░░░░░░░░██░░░░░░░░░░░░░░░░░░░░   45ms
LLM Call 2       ░░░░░░░░░░████████░░░░░░░░░░░░  600ms
─────────────────────────────────────────────────
Total                                            1,445ms
```

**Diff View** (comparing two traces):
```
Trace A (abc-123)          vs    Trace B (def-456)
─────────────────────────────────────────────────────
[LLM] Look up order        =    [LLM] Look up order
[TOOL] GetItem              =    [TOOL] GetItem
[LLM] Compose response     ≠    [LLM] Check inventory  ← DIVERGENCE
                                 [TOOL] Query inventory
                                 [LLM] Compose response
─────────────────────────────────────────────────────
Divergence at step 3: Different reasoning path chosen
```

### 3.4 Alert Engine

**Alert Rules**:

| Rule | Condition | Action |
|------|-----------|--------|
| Loop detected | Same step hash 3x in window | SNS + CW metric |
| High latency | Trace > 30s total | CW alarm |
| Token budget exceeded | Trace > 5000 tokens | SNS warning |
| Tool failure ignored | Tool returns error, agent continues | CW metric |
| Low coherence | Trace coherence < 0.5 | SNS alert |
| Confidence drop | Step confidence drops > 0.3 from previous | CW metric |

## 4. Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| CLI | TypeScript + Commander.js | Consistent with Problem 1 |
| Trace Storage | DynamoDB | Serverless, TTL support, fast queries |
| Visualization | blessed + blessed-contrib | Rich terminal UI |
| Alerting | CloudWatch + SNS | Native AWS integration |
| Instrumentation | OpenTelemetry-compatible spans | Industry standard |
| Coherence Scoring | Heuristic (no external LLM call) | Zero additional cost |
| Self-Update | GitHub config repo | Version-controlled parsers |

## 5. Integration with Problem 1

The two tools share:
- **Self-update module**: Same mechanism for pulling latest configs
- **Role ARN context**: Traces are correlated with IAM observations
- **Combined insight**: "Agent called dynamodb:Query (traced) → needs dynamodb:Query permission (IAM tool)"

```
┌─────────────────────────────────────────────────┐
│  Problem 2: Trace shows agent called DynamoDB   │
│  → Feeds into Problem 1: Confirms IAM need      │
│  → Combined: "Agent needs dynamodb:Query on     │
│     table X because of reasoning step 3"        │
└─────────────────────────────────────────────────┘
```

## 6. Security Considerations

1. **PII Redaction**: All stored traces pass through redaction pipeline before persistence
2. **Encryption**: DynamoDB table uses AWS-managed KMS key
3. **Access Control**: Traces scoped by role ARN — users only see their own agents' traces
4. **Retention**: Default 30-day TTL, configurable per-trace
5. **No prompt storage by default**: Only reasoning summaries stored unless explicitly opted in

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| Bedrock trace not enabled | Error with instructions to enable `enableTrace: true` |
| DynamoDB throttling | Exponential backoff, buffer in memory |
| Trace too large (>400KB DynamoDB limit) | Split across multiple items |
| Agent session timeout | Mark trace as "timeout", store partial |
| Instrumentation failure | Graceful degradation — agent continues without tracing |
