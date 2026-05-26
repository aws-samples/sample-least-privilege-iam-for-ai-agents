# AgentGuard — Demonstration Guide

## What Is It?

It's a **CLI tool** (command-line application) — not a web app, not a SaaS. Two commands you install and run in your terminal:
- `agentic-iam` — observes agent permissions, generates policies, detects drift
- `agent-tracer` — traces agent reasoning, scores quality, alerts on issues

## The Problem with Demonstrating It Live

To demo the **real** tool, you'd need:
- An AWS account with CloudTrail enabled
- A Bedrock Agent deployed and running
- DynamoDB table provisioned
- IAM roles configured

That's too many dependencies for a hackathon demo.

## The Solution: Self-Contained Demo Mode

We build a **demo mode** that uses:
- Pre-recorded sample data (no AWS account needed)
- Local SQLite database (no DynamoDB needed)
- Simulated agent traces (no Bedrock Agent needed)
- Everything runs on the reviewer's laptop with just `node` installed

### How Anyone Can Run It

```bash
# 1. Clone and install
git clone <repo>
cd agentic-iam-tool
npm install

# 2. Run the demo (zero AWS dependency)
npm run demo
```

That's it. The demo:
1. Seeds the local database with realistic sample observations
2. Generates a least-privilege policy from those observations
3. Runs drift detection showing over/under-permissioned actions
4. Shows a reasoning trace with coherence scoring
5. Detects a loop and a hallucination in the sample trace
6. Renders terminal visualizations (DAG, waterfall, diff)
7. Shows the self-update mechanism checking for freshness

### What the Reviewer Sees

```
═══════════════════════════════════════════════════════════
  AgentGuard Demo — Self-Updating IAM + Reasoning Tracer
═══════════════════════════════════════════════════════════

[1/7] Seeding sample agent observations...
  ✓ 47 API calls from role "BedrockAgentRole" loaded

[2/7] Generating least-privilege policy...
  ✓ Policy generated: 4 statements, 12 actions, 6 specific resources
  ✓ Saved to: ./demo-output/generated-policy.json

[3/7] Running drift detection...
  ⚠ DRIFT DETECTED:
    [HIGH] under-permissioned: bedrock:InvokeModel (used but not granted)
    [MEDIUM] over-permissioned: s3:DeleteObject (granted but never used)
    [LOW] stale: sns:ListTopics (not used in 30+ days)

[4/7] Tracing agent reasoning...
  ✓ Trace loaded: 6 steps, 1,450 tokens, 1.2s total

[5/7] Analyzing reasoning quality...
  Coherence score: 0.72
  ⚠ Loop detected: steps 3→4→5 repeat "lookup order" pattern (340 tokens wasted)
  ⚠ Hallucination: Agent claims "order shipped" but tool returned "not found"

[6/7] Rendering visualizations...

  ┌─ Trace: abc-1234 ──────────────────────────────────┐
  │  [LLM] "Need to look up order status"              │
  │    ▼                                                │
  │  [TOOL] dynamodb:GetItem → {status: "not found"}   │
  │    ▼                                                │
  │  [LLM] ⚠ "The order has been shipped" ← WRONG     │
  │    ▼                                                │
  │  [OUTPUT] "Your order #12345 has been shipped"      │
  │                                                     │
  │  Coherence: 0.72 | Tokens: 1,450 | Cost: $0.0043   │
  └─────────────────────────────────────────────────────┘

[7/7] Checking self-update freshness...
  Action DB version: 2026-05-20
  ✓ Database is current (6 days old)
  Services tracked: 14 | Actions tracked: 127

═══════════════════════════════════════════════════════════
  Demo complete. All output saved to ./demo-output/
═══════════════════════════════════════════════════════════
```

## What Gets Demonstrated

| Feature | How It's Shown |
|---------|---------------|
| Observation | Pre-loaded CloudTrail-like data |
| Policy generation | Real engine generates real JSON policy |
| Drift detection | Real comparison logic finds real mismatches |
| Reasoning tracing | Sample trace with realistic agent steps |
| Coherence scoring | Real algorithm scores the sample trace |
| Loop detection | Real algorithm finds the loop |
| Hallucination detection | Real algorithm catches the contradiction |
| Terminal visualization | Real renderer draws the DAG |
| Self-update | Real freshness check on action database |

## Dependencies to Run Demo

| Requirement | Available? |
|-------------|-----------|
| Node.js 20+ | Yes, on any machine |
| AWS Account | ❌ NOT needed for demo |
| Bedrock Agent | ❌ NOT needed for demo |
| DynamoDB | ❌ NOT needed for demo |
| Internet | ❌ NOT needed for demo |

**Zero cloud dependencies. Runs entirely offline on any machine with Node.js.**
