# Continuous Least-Privilege IAM for Non-Deterministic AI Agents on AWS

**Author:** Tarun Kumar (AWS)
**Content Type:** Pattern
**Categories:** Security and Compliance, Machine Learning, DevOps

---

## Reviewer Response (addressing feedback from Durga Prasad, 31 May 2026)

### Point 1: Differentiation from IAM Access Analyzer

| Capability | IAM Access Analyzer | This Pattern |
|---|---|---|
| Policy generation source | CloudTrail (historical, one-time) | CloudTrail (continuous, scheduled) |
| Target workload | Any IAM principal (static behavior assumed) | Non-deterministic AI agents (behavior varies per invocation) |
| Drift detection | No — generates once, no ongoing comparison | Yes — compares current policy vs. observed behavior on schedule |
| Stale permission detection | No | Yes — flags actions unused for N days |
| Session-aware scoping | No — aggregates all calls | Yes — groups API calls by agent session/invocation to identify per-tool-path permission sets |
| Action database freshness | Depends on service update cycle | Self-updates from botocore; warns if >7 days stale, errors if >30 days |
| Resource-level constraints | Limited — often uses `*` for resources | Infers resource ARN patterns from CloudTrail `requestParameters` |

**In summary:** IAM Access Analyzer is a point-in-time tool for deterministic workloads. This pattern provides a continuous observation-and-update architecture specifically designed for AI agents whose API call surface is unpredictable and evolves over time.

---

### Point 2: Differentiation from Existing Pattern (47096d37)

The existing pattern "Implementing Least Privilege Access in AWS via CloudTrail API Analysis" covers:
- One-time CloudTrail analysis during **development phase**
- Generating a policy for **deterministic applications** (the app's API calls are predictable once code is stable)
- Manual process: collect logs → analyze → generate policy → apply

**What this pattern adds (novel contributions):**

| Aspect | Existing Pattern (47096d37) | This Pattern |
|---|---|---|
| Workload type | Deterministic apps (Lambda, ECS) | Non-deterministic AI agents (Bedrock, LangChain) |
| When to use | Development phase (before prod) | Production-continuous (agent behavior changes with prompts/tools) |
| Observation model | One-time collection window | Continuous EventBridge-triggered collection |
| Output | Static policy document | Policy + drift report + PR-ready diff |
| Drift detection | Not covered | Core feature — detects over/under-permissioned states |
| Self-maintenance | Manual re-run | Automated: self-updating action DB, scheduled re-analysis |
| Agent session awareness | N/A | Groups calls by invocation to identify tool-specific permission paths |

**Why this matters for AI agents:** A Bedrock Agent with 5 tools might call S3, DynamoDB, and Lambda in one invocation, then call Bedrock, SQS, and SNS in the next — depending on user input. The existing pattern assumes you can observe all possible calls during dev. With agents, you cannot.

---

### Point 3: Scope — Single Pattern (IAM Only)

✅ **Accepted.** This submission covers **only** the IAM policy generation and drift detection architecture for AI agents.

The reasoning tracer (Problem 2) will be submitted separately as an independent pattern: "Tracing and Scoring Reasoning Quality in Agentic AI Workloads."

---

### Point 4: Content Type — This is a Deployable Architecture (Pattern)

✅ **Confirmed: This is a Pattern (deployable architecture), not a standalone tool.**

The architecture deploys via AWS CDK and consists of:
- EventBridge rule → Lambda (CloudTrail event collector)
- S3 bucket (observation store)
- Step Functions (scheduled analysis workflow)
- SNS (drift alerts)
- CodeCommit/CodePipeline integration (PR-ready policy output)

The CLI is a management interface for the deployed infrastructure, not the core deliverable.

---

## Pattern Content (Revised)

### Title
Continuous Least-Privilege IAM for Non-Deterministic AI Agents on AWS

### Summary
Deploy an automated architecture that continuously observes AI agent API calls via CloudTrail, generates minimal IAM policies with resource-level scoping, detects permission drift, and self-updates as AWS adds new service actions.

### Problem Statement
When deploying AI agents (Amazon Bedrock Agents, LangChain on Lambda, custom agent frameworks), developers face a unique IAM challenge: agent behavior is non-deterministic. The same agent may invoke different AWS APIs depending on user input, tool selection, and reasoning paths.

This leads to:
- **Overly broad permissions** (`*` wildcards) because developers can't predict which APIs the agent will call
- **No drift detection** — as agent prompts/tools evolve, required permissions change silently
- **Compliance risk** — least-privilege is a requirement (SOC 2, FedRAMP, PCI DSS) but impossible to achieve manually for agents

Existing solutions (IAM Access Analyzer, the existing CloudTrail analysis pattern) assume deterministic workloads where a development-phase observation captures all possible API calls. For AI agents, this assumption doesn't hold.

### Target Audience
- Cloud architects deploying AI agents on AWS
- Security engineers responsible for least-privilege compliance
- DevOps engineers managing agent infrastructure
- ML engineers building agentic applications with Bedrock or custom frameworks

### Prerequisites
- AWS account with CloudTrail enabled (management + data events for target services)
- AI agent deployed with a dedicated IAM role
- AWS CDK CLI installed (for infrastructure deployment)
- Node.js 20+ (for the management CLI)
- Basic understanding of IAM policies and CloudTrail event structure
- **Outbound internet access** — The self-update Lambda requires outbound HTTPS access to `raw.githubusercontent.com` to fetch the latest botocore IAM action definitions. If deployed in a VPC, configure a NAT gateway or HTTPS proxy. Without internet access, the IAM action database cannot auto-refresh and must be updated manually.

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          AI Agent Runtime                                  │
│               (Bedrock Agent / LangChain / Custom)                        │
│                    IAM Role: AgentExecutionRole                            │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ API Calls
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         AWS CloudTrail                                     │
│              (Management + Data Events)                                    │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ Events
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Amazon EventBridge Rule                                                   │
│  Filter: userIdentity.arn = AgentExecutionRole                            │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ Matched Events
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AWS Lambda: ObservationCollector                                          │
│  - Extracts: service, action, resources, timestamp, session ID            │
│  - Normalizes resource ARNs                                               │
│  - Stores in S3 (partitioned by date)                                     │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Amazon S3: Observation Store                                              │
│  s3://agent-iam-observations/{role}/{date}/events.jsonl                   │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ Scheduled trigger (daily/weekly)
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AWS Step Functions: PolicyAnalysisWorkflow                                │
│                                                                            │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────┐   ┌────────────┐ │
│  │ Aggregate   │──▶│ Generate     │──▶│ Compare vs  │──▶│ Output     │ │
│  │ Observations│   │ Min Policy   │   │ Current     │   │ Report     │ │
│  └─────────────┘   └──────────────┘   └─────────────┘   └────────────┘ │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│ S3: Policy   │  │ SNS: Drift   │  │ CodeCommit: PR   │
│ Artifacts    │  │ Alerts       │  │ with policy diff  │
└──────────────┘  └──────────────┘  └──────────────────┘
```

### AWS Services Used

| Service | Role |
|---|---|
| AWS CloudTrail | Source of API call observations |
| Amazon EventBridge | Real-time event filtering by agent role |
| AWS Lambda | Event collection and normalization |
| Amazon S3 | Observation storage (partitioned, lifecycle-managed) |
| AWS Step Functions | Orchestrates analysis workflow |
| Amazon SNS | Drift alert notifications |
| AWS CDK | Infrastructure as code |
| AWS CodeCommit (optional) | PR-based policy update workflow |

### Tools and Code

| Tool | Purpose |
|---|---|
| AWS CDK (TypeScript) | Deploy observation infrastructure |
| Management CLI (TypeScript) | On-demand observation, generation, drift check |
| [botocore service model definitions](https://github.com/boto/botocore/tree/develop/botocore/data) | Self-updating IAM action reference (fetched from GitHub) |

Repository: `https://code.aws.dev/personal_projects/alias_t/tarrych/AgentGuard`

---

## Epics

### Epic 1: Deploy Observation Infrastructure

Deploy the CloudTrail-to-S3 observation pipeline that continuously captures AI agent API calls.

#### Story 1.1: Configure CloudTrail for Agent Observation

1. Ensure CloudTrail is enabled with management events in the target region.
2. For services that require data events (S3, Lambda, DynamoDB), enable data event logging for the agent's execution role ARN.
3. Verify events are flowing by checking the CloudTrail console Event History.

#### Story 1.2: Deploy the CDK Stack

1. Clone the repository and navigate to the infrastructure directory.
2. Configure the target agent role ARN in `cdk.json` or pass via context:
   ```bash
   cd problem-1-iam-scoping/infra
   npx cdk deploy --context agentRoleArn=arn:aws:iam::123456789012:role/MyAgentRole
   ```
3. The stack deploys:
   - EventBridge rule filtered to the agent role's ARN
   - Lambda function for event collection and normalization
   - S3 bucket with lifecycle policy (90-day retention default)
   - Step Functions state machine for scheduled analysis
   - SNS topic for drift alerts
4. Subscribe to the SNS topic (email, Slack, or PagerDuty integration).

#### Story 1.3: Verify the Pipeline

1. Trigger the AI agent (invoke it normally or use a test prompt).
2. Wait at least 15 minutes for CloudTrail event delivery (average is ~5 minutes, but delivery is not guaranteed within a specific time).
3. Check the S3 observation bucket for new event records:
   ```bash
   aws s3 ls s3://agent-iam-observations/{role}/{date}/
   ```
4. Confirm the Lambda function executed successfully (check CloudWatch Logs).

---

### Epic 2: Generate Least-Privilege Policy

Analyze collected observations and produce a minimal IAM policy.

#### Story 2.1: Run Initial Observation Period

1. Allow the agent to run under normal production conditions for a minimum of 7 days (recommended: 14 days) to capture the full range of non-deterministic behavior.
2. Monitor the observation count:
   ```bash
   agentic-iam observe --role-arn arn:aws:iam::123456789012:role/MyAgentRole --days 7 --summary
   ```
3. Verify that observations cover multiple distinct agent sessions (different user inputs triggering different tool paths).

#### Story 2.2: Generate the Policy

1. Run policy generation:
   ```bash
   agentic-iam generate \
     --role-arn arn:aws:iam::123456789012:role/MyAgentRole \
     --output policy.json
   ```
2. The engine:
   - Aggregates all unique `service:action` pairs from observations
   - Infers resource ARN patterns from `requestParameters` (e.g., specific S3 buckets, DynamoDB tables)
   - Groups related actions into policy statements by service
   - Applies condition keys where applicable (e.g., `aws:SourceArn`)
3. Review the generated `policy.json`. Verify resource ARNs are scoped (not `*`).

#### Story 2.3: Apply the Policy

1. Compare generated policy against the current attached policy:
   ```bash
   agentic-iam drift --role-arn arn:aws:iam::123456789012:role/MyAgentRole
   ```
2. Review the diff output showing:
   - **Over-permissioned:** Actions in current policy never observed in use
   - **Under-permissioned:** Actions observed but missing from current policy
   - **Correctly scoped:** Actions in both with matching resources
3. Apply the policy via IAM console, CLI, or automated PR workflow.

---

### Epic 3: Enable Continuous Drift Detection

Set up ongoing monitoring that detects when agent behavior diverges from its IAM policy.

#### Story 3.1: Configure Scheduled Analysis

1. The Step Functions state machine runs on a configurable schedule (default: daily).
2. Customize the schedule in CDK:
   ```typescript
   new Rule(this, 'AnalysisSchedule', {
     schedule: Schedule.rate(Duration.days(1)),
     targets: [new SfnStateMachine(analysisWorkflow)],
   });
   ```
3. Each run compares the latest observation window against the current IAM policy.

#### Story 3.2: Configure Drift Alerts

1. Define drift thresholds:
   - **Over-permissioned alert:** >10 unused actions for >14 days
   - **Under-permissioned alert:** Any denied API call (immediate)
   - **Stale permission alert:** Action unused for >30 days
2. Alerts publish to the SNS topic with:
   - Role ARN affected
   - List of drifted actions
   - Suggested policy change (add/remove)
   - Link to generated PR (if CodeCommit integration enabled)

#### Story 3.3: Review and Act on Drift Reports

1. When a drift alert fires, review the generated report:
   ```bash
   agentic-iam report --role-arn arn:aws:iam::123456789012:role/MyAgentRole
   ```
2. The report includes:
   - Actions to add (agent needs but doesn't have)
   - Actions to remove (agent has but doesn't use)
   - Confidence score (based on observation volume)
   - Recommendation: apply immediately vs. extend observation window
3. For automated workflows: the system creates a PR with the updated policy file.

---

### Epic 4: Self-Update the IAM Action Database

Ensure the policy generator recognizes newly released AWS service actions.

#### Story 4.1: Configure Self-Update Schedule

1. The action database update runs automatically before each policy generation.
2. If the database is >7 days old, a warning is logged.
3. If >30 days old, generation fails with an error (prevents generating incomplete policies).

#### Story 4.2: Manual Update (Optional)

1. Trigger a manual update:
   ```bash
   agentic-iam update --source botocore
   ```
2. The updater:
   - Fetches latest service model definitions from the botocore GitHub repository
   - Diffs against the local action database
   - Adds new actions, flags deprecated ones
   - Versions the database with a timestamp
3. Review the update log to see newly added services/actions.

---

## Additional Information

### Cost Considerations
- CloudTrail management events: Included free (first trail) — [CloudTrail Pricing](https://aws.amazon.com/cloudtrail/pricing/)
- CloudTrail data events: $0.10 per 100,000 events — [CloudTrail Pricing](https://aws.amazon.com/cloudtrail/pricing/)
- Lambda invocations: Minimal (event-driven, short duration)
- S3 storage: ~1 KB per event; 90-day lifecycle default
- Step Functions: Standard workflow pricing (~$0.025 per 1,000 state transitions) — [Step Functions Pricing](https://aws.amazon.com/step-functions/pricing/)

### Security Considerations
- The observation Lambda has read-only access to CloudTrail events
- Generated policies follow least-privilege — the tool itself requires minimal permissions
- No agent credentials or secrets are stored; only API call metadata
- S3 bucket is encrypted (SSE-S3) with bucket policy restricting access

### Limitations
- CloudTrail typically delivers log files within about 5 minutes of an API call (up to 15 minutes); real-time policy generation is not supported — [Getting and viewing your CloudTrail log files](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/get-and-view-cloudtrail-log-files.html)
- Some API calls (e.g., STS `AssumeRole` in chain) may not attribute clearly to the agent role
- Minimum 7-day observation recommended for coverage confidence
- Does not cover resource-based policies (only identity-based)
- Generated policies are validated against the IAM managed policy size limit of 6,144 non-whitespace characters — [IAM and STS character limits](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html)

### Related Patterns
- [Implementing Least Privilege Access in AWS via CloudTrail API Analysis](https://apg-library.amazonaws.com/content/47096d37-0482-4886-b17f-b6cb3188d891) — For deterministic workloads during development phase
- [Guidelines on Least Privilege for IAM Policies](https://apg-library.amazonaws.com/content/71145ac0-3957-4c84-9d7e-ecd4d20b7b2e) — General IAM best practices guide
