# Agentic IAM Tool — Self-Updating IAM Policy Generator + Agent Reasoning Tracer

> Solving two critical challenges in Agentic AI on AWS, built to showcase Kiro's full capabilities.

## Overview

This project tackles two of the hardest problems developers face when deploying AI agents on AWS:

| Problem | Solution | Folder |
|---------|----------|--------|
| **IAM Scoping** — Agents make non-deterministic API calls, making least-privilege impossible to predict | Observe → Generate → Detect Drift | `problem-1-iam-scoping/` |
| **Debugging Opacity** — Standard observability tools don't capture agent reasoning quality | Trace → Analyze → Alert | `problem-2-observability/` |

Both tools **self-update** by pulling the latest AWS IAM action definitions and trace format parsers, ensuring they stay current as AWS evolves.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Agent Runtime                                 │
│              (Bedrock / LangChain / Custom)                           │
└────────────┬────────────────────────────────────┬───────────────────┘
             │                                    │
             ▼                                    ▼
┌────────────────────────────┐    ┌────────────────────────────────────┐
│  Problem 1: IAM Scoping    │    │  Problem 2: Reasoning Tracer       │
│                            │    │                                    │
│  CloudTrail → Observe      │    │  Instrument → Collect Traces       │
│  Analyze → Generate Policy │    │  Analyze → Score Coherence         │
│  Compare → Detect Drift    │    │  Visualize → Terminal Dashboard    │
│  Alert → PR-ready output   │    │  Alert → CloudWatch + SNS         │
└────────────┬───────────────┘    └──────────────┬─────────────────────┘
             │                                    │
             └──────────────┬─────────────────────┘
                            ▼
              ┌──────────────────────────┐
              │  Shared: Self-Update     │
              │  - Pulls botocore data   │
              │  - Updates action DB     │
              │  - Adapts to new formats │
              └──────────────────────────┘
```

---

## Problem 1: Agentic IAM Policy Generator

**The Problem**: When you deploy a Bedrock Agent, what IAM permissions does it actually need? You can't know upfront because agent behavior is non-deterministic.

**The Solution**: Observe the agent's actual API calls via CloudTrail, then generate a minimal policy.

### Commands

```bash
# Observe agent behavior (collects CloudTrail events)
agentic-iam observe --role-arn arn:aws:iam::123456789012:role/MyAgentRole --days 7

# Generate least-privilege policy
agentic-iam generate --role-arn arn:aws:iam::123456789012:role/MyAgentRole --output policy.json

# Detect drift (over/under-permissioned)
agentic-iam drift --role-arn arn:aws:iam::123456789012:role/MyAgentRole

# Self-update action database
agentic-iam update --source botocore

# Full report
agentic-iam report --role-arn arn:aws:iam::123456789012:role/MyAgentRole
```

### Key Features
- ✅ Observes real agent behavior via CloudTrail
- ✅ Generates minimal IAM policies with resource-level scoping
- ✅ Detects drift: over-permissioned, under-permissioned, stale
- ✅ Self-updates IAM action database from botocore
- ✅ CDK stack for automated observation infrastructure

---

## Problem 2: Agent Reasoning Tracer

**The Problem**: When an agent gives a wrong answer, CloudWatch tells you latency was 2.3s. But *why* was the answer wrong? Which reasoning step failed?

**The Solution**: Trace the full reasoning chain, score coherence, detect loops and hallucinations.

### Commands

```bash
# View a specific trace
agent-tracer trace --trace-id abc-123

# Analyze recent traces
agent-tracer analyze --role-arn arn:aws:iam::123456789012:role/MyAgentRole --last 10

# Compare two traces (debug non-determinism)
agent-tracer diff abc-123 def-456

# View/configure alert rules
agent-tracer alert --list
```

### Key Features
- ✅ Traces LLM calls, tool invocations, and decisions
- ✅ Scores reasoning coherence (does step N follow step N-1?)
- ✅ Detects reasoning loops (agent stuck in a cycle)
- ✅ Detects hallucinations (LLM claims contradict tool output)
- ✅ Terminal visualization: DAG, waterfall, diff views
- ✅ Alerting via CloudWatch metrics + SNS notifications
- ✅ PII redaction on all stored traces

---

## Self-Update Mechanism

Both tools share a self-update module that keeps them current:

```bash
# Update IAM action database (Problem 1)
agentic-iam update --source botocore

# Checks freshness automatically before policy generation
# Warns if action DB is > 7 days old
# Errors if > 30 days old
```

**How it works**:
1. Fetches latest service models from botocore (GitHub)
2. Diffs against current local action database
3. Merges new actions, flags deprecated ones
4. Versions the database with timestamps
5. Logs all changes for audit

---

## Kiro Features Demonstrated

| Feature | Problem 1 | Problem 2 |
|---------|-----------|-----------|
| **Specs** | Requirements + Design docs | Requirements + Design docs |
| **Steering** | IAM best practices, security rules | Privacy rules, analysis heuristics |
| **Hooks (on-save)** | Validate generated policy JSON | PII leak detection in source |
| **Hooks (on-commit)** | Run drift detection | Trace format compatibility |
| **Hooks (on-generate)** | Check action DB freshness | — |
| **Hooks (on-trace)** | — | Auto-analyze + alert |

---

## Project Structure

```
agentic-iam-tool/
├── problem-1-iam-scoping/
│   ├── specs/requirements.md
│   ├── design/architecture.md
│   ├── src/
│   │   ├── types.ts
│   │   ├── collector/store.ts        # SQLite observation store
│   │   ├── collector/collector.ts    # CloudTrail log collector
│   │   ├── engine/policy-engine.ts   # Policy generation logic
│   │   ├── engine/drift-detector.ts  # Drift detection
│   │   └── cli/index.ts             # CLI commands
│   ├── infra/cdk-stack.ts           # AWS CDK infrastructure
│   ├── kiro/
│   │   ├── steering/project-rules.md
│   │   └── hooks/
│   │       ├── on-save-validate-policy.md
│   │       ├── on-commit-drift-check.md
│   │       └── on-generate-update-check.md
│   ├── package.json
│   └── tsconfig.json
├── problem-2-observability/
│   ├── specs/requirements.md
│   ├── design/architecture.md
│   ├── src/
│   │   ├── types.ts
│   │   ├── tracer/collector.ts       # Trace collection + PII redaction
│   │   ├── tracer/store.ts           # DynamoDB trace store
│   │   ├── dashboard/analyzer.ts     # Reasoning analysis engine
│   │   ├── dashboard/renderer.ts     # Terminal visualization
│   │   ├── alerting/alert-engine.ts  # CloudWatch + SNS alerts
│   │   └── cli/index.ts             # CLI commands
│   ├── kiro/
│   │   ├── steering/project-rules.md
│   │   └── hooks/
│   │       ├── on-trace-complete.md
│   │       ├── on-save-pii-check.md
│   │       └── on-commit-format-check.md
│   └── package.json
├── shared/
│   └── self-update/index.ts          # Shared self-update module
└── README.md                         # This file
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- AWS CLI configured with appropriate credentials
- AWS account with CloudTrail enabled

### Installation

```bash
# Problem 1
cd problem-1-iam-scoping
npm install
npm run build

# Problem 2
cd problem-2-observability
npm install
npm run build
```

### Deploy Infrastructure (Problem 1)

```bash
cd problem-1-iam-scoping/infra
npx cdk deploy --context agentRoleArn=arn:aws:iam::123456789012:role/MyAgentRole
```

---

## Why These Problems?

1. **Every AWS developer** struggles with IAM — it's consistently the #1 pain point
2. **Every AI developer** struggles with debugging agent reasoning — it's the #1 blocker to production
3. **Self-updating** ensures the tool doesn't become stale as AWS adds ~50 new IAM actions/month
4. **Combined insight**: The tracer tells you *what* the agent did and *why*; the IAM tool tells you *what permissions it needs* — together they provide complete agent governance

---

## License

MIT
