# AgentGuard — Competitive Landscape & Uniqueness

## What Already Exists

### 1. AWS IAM Access Analyzer (AWS Native)
- **What it does**: Looks at CloudTrail logs and generates an IAM policy based on what a role actually did
- **Limitation**: One-time snapshot. Generates a policy once, doesn't monitor ongoing changes. Not agent-aware — treats a Bedrock Agent the same as a Lambda function. No concept of "the agent changed behavior because the model was updated."

### 2. iamlive (Open Source — 5k+ GitHub stars)
- **What it does**: Monitors AWS API calls in real-time from the client side and generates a matching IAM policy
- **Limitation**: Requires running alongside the agent locally. No drift detection. No understanding of why the agent made those calls. Doesn't work with serverless agent deployments.

### 3. LangSmith (LangChain — SaaS)
- **What it does**: Traces LLM calls, tool invocations, and agent steps. Shows the full reasoning chain visually.
- **Limitation**: SaaS product (data leaves your AWS account). No IAM integration. No coherence scoring — shows traces but doesn't tell you if the reasoning was *good*. No loop or hallucination detection. Not AWS-native.

### 4. Braintrust / Arize Phoenix / LangFuse
- **What they do**: AI observability platforms — trace agent runs, evaluate outputs, track costs.
- **Limitation**: General-purpose LLM monitoring. No IAM awareness. No drift detection. No connection between "what the agent did" and "what permissions it needs." External SaaS, not embedded in the IDE/CLI.

### 5. AWS Bedrock AgentCore (Newly Launched)
- **What it does**: Provides basic tracing, identity management, and deployment infrastructure for Bedrock Agents.
- **Limitation**: Infrastructure-level observability only. Shows that a tool was called, not whether the reasoning was coherent. No quality scoring. No policy generation. No drift alerting.

### 6. TrailTool.io (Open Source + Hosted)
- **What it does**: Ingests CloudTrail logs, lets you browse sessions, generate policies, respond to AccessDenied errors.
- **Limitation**: General-purpose CloudTrail browser. Not agent-specific. No reasoning tracing. No behavioral drift detection.

---

## Why AgentGuard Is Unique

### The Gap AgentGuard Addresses

```
Existing tools answer:          AgentGuard answers:
─────────────────────────       ─────────────────────────────────────
"What API calls were made?"     "WHY did the agent make those calls?"
"Here's a policy for today"     "The agent's behavior CHANGED — here's what's new"
"Here's the trace"              "The reasoning was INCOHERENT at step 3"
"Tool X was called"             "The agent IGNORED the tool's error response"
"Latency was 2.3s"             "The agent was STUCK IN A LOOP for 4 iterations"
```

### Five Differentiators

| # | Differentiator | Why It Matters |
|---|---------------|----------------|
| 1 | **Combines IAM + Reasoning** | No existing tool connects "what permissions are needed" with "why the agent needed them." AgentGuard does both. |
| 2 | **Continuous Drift Detection** | IAM Access Analyzer generates once. AgentGuard continuously monitors and alerts when agent behavior changes (new model version, new tools added). |
| 3 | **Reasoning Quality Scoring** | LangSmith shows traces. AgentGuard *scores* them — coherence, loop detection, hallucination flagging. Actionable, not just visual. |
| 4 | **Self-Updating** | Every other tool becomes stale. AgentGuard pulls latest IAM actions from botocore and adapts trace parsers to new Bedrock formats automatically. |
| 5 | **Kiro-Native Agent Skill** | Not a separate SaaS. Embedded in the developer workflow with hooks (on-save, on-commit) and steering rules. Zero context-switching. |

### The Unified Story

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   LangSmith        IAM Access Analyzer       AgentGuard     │
│   ─────────        ────────────────────      ──────────     │
│                                                             │
│   "Agent called    "Role used these          "Agent called  │
│    DynamoDB"        actions last week"         DynamoDB      │
│                                                BECAUSE of   │
│                                                reasoning    │
│                                                step 3,      │
│                                                which was    │
│                                                INCOHERENT,  │
│                                                and it needs │
│                                                dynamodb:    │
│                                                Query on     │
│                                                table X,     │
│                                                which DRIFTED│
│                                                from last    │
│                                                week's       │
│                                                policy"      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Summary

**Individual pieces exist. AgentGuard combines them.**

AgentGuard answers questions like: *"Your agent needs `dynamodb:Query` permission on table `Orders` because at reasoning step 3, it decided to look up order status — but that reasoning was only 60% coherent, and this permission wasn't needed last week before you updated the model."*

AgentGuard combines IAM scoping, reasoning quality scoring, and drift detection in a single developer-native tool — providing **complete agent governance** (security + quality + evolution) from a unified interface.
