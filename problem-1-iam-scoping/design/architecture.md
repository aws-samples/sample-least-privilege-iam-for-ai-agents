# Problem 1: Agentic IAM Policy Generator — Design Document

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Runtime Environment                      │
│  (Bedrock Agent / LangChain / Custom Orchestrator)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ API Calls (assumed role)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                        AWS CloudTrail                             │
│  - Management events                                             │
│  - Data events (S3, DynamoDB, Lambda)                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Events delivered to S3 / CloudWatch
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 1: Log Collector                               │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ EventBridge Rule│→ │ Collector Lambda │→ │ SQLite Store  │  │
│  │ (role ARN filter)│  │ (parse & dedupe) │  │ (local/S3)    │  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Structured action records
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 2: Policy Engine                               │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Action Analyzer │→ │ Policy Builder   │→ │ Validator     │  │
│  │ (group/dedupe)  │  │ (least-privilege)│  │ (IAM grammar) │  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Generated policy + diff
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 3: Drift Detector                              │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Current Policy  │→ │ Diff Engine      │→ │ Alert/Report  │  │
│  │ Fetcher (IAM API)│  │ (over/under perm)│  │ Generator     │  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 4: Self-Update Module                          │
│  ┌─────────────────┐  ┌──────────────────┐                     │
│  │ AWS Action DB   │→ │ Version Manager  │                     │
│  │ Puller (GitHub/ │  │ (diff & merge)   │                     │
│  │  SDK metadata)  │  └──────────────────┘                     │
│  └─────────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Component Design

### 2.1 Log Collector

**Purpose**: Gather and normalize CloudTrail events for a specific agent role.

**Data Flow**:
1. EventBridge rule matches CloudTrail events where `userIdentity.arn` contains the target role
2. Matched events are sent to a collector Lambda (or pulled via CLI from CloudTrail Lookup API)
3. Events are parsed into structured records:

```typescript
interface ObservedAction {
  service: string;        // e.g., "dynamodb"
  action: string;         // e.g., "GetItem"
  resourceArn: string;    // e.g., "arn:aws:dynamodb:us-east-1:123456:table/MyTable"
  timestamp: string;      // ISO 8601
  requestParams?: Record<string, any>;  // for condition key extraction
  sourceIp?: string;
  userAgent?: string;
}
```

**Storage Schema (SQLite)**:
```sql
CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_arn TEXT NOT NULL,
  service TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_arn TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  request_params TEXT,  -- JSON
  run_id TEXT,          -- groups observations by collection run
  UNIQUE(role_arn, service, action, resource_arn)  -- deduplication
);

CREATE TABLE collection_runs (
  run_id TEXT PRIMARY KEY,
  role_arn TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  event_count INTEGER
);
```

### 2.2 Policy Engine

**Purpose**: Transform observed actions into a minimal IAM policy.

**Algorithm**:
```
1. Query all unique (service, action, resource_arn) tuples for the role
2. Group by service
3. For each service group:
   a. If all resources are specific ARNs → use them directly
   b. If resources share a prefix → use wildcard (e.g., arn:aws:s3:::my-bucket/*)
   c. Apply resource-level permission check (some actions don't support resource-level)
4. Generate policy statements (one per service for readability)
5. Add condition keys where observed (e.g., source VPC, encryption context)
6. Validate against IAM policy size limits (6,144 chars inline, 10,240 managed)
```

**Output Format**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:123456789012:table/AgentData",
        "arn:aws:dynamodb:us-east-1:123456789012:table/AgentData/index/*"
      ]
    }
  ]
}
```

### 2.3 Drift Detector

**Purpose**: Compare current policy against observed behavior to find mismatches.

**Drift Categories**:

| Category | Description | Severity |
|----------|-------------|----------|
| Over-permissioned | Action in policy but never observed | Medium |
| Under-permissioned | Action observed but not in policy (implicit deny) | High |
| Resource drift | Action observed on new resources not in policy | High |
| Stale permissions | Action not observed in 30+ days | Low |
| New behavior | Action appeared after last policy generation | Medium |

**Comparison Algorithm**:
```
1. Fetch current policy (attached + inline) for the role
2. Expand wildcards in policy to known action list
3. Compare expanded policy actions against observed actions
4. Classify each mismatch into drift categories
5. Score overall drift severity
```

### 2.4 Self-Update Module

**Purpose**: Keep the tool's IAM action database current without code changes.

**Data Sources**:
- AWS IAM Actions Reference (scraped/parsed from docs)
- AWS SDK service model files (botocore/service-2.json)
- AWS changelog RSS feed

**Update Flow**:
```
1. Check current action DB version (stored in metadata.json)
2. Fetch latest service model from botocore GitHub
3. Diff new actions vs. current DB
4. Merge new actions, flag deprecated ones
5. Write updated DB with new version timestamp
6. Log changes for audit
```

## 3. CLI Design

```
agentic-iam <command> [options]

Commands:
  observe     Collect CloudTrail events for an agent role
  generate    Generate least-privilege policy from observations
  drift       Detect policy drift
  update      Update IAM action database
  report      Generate human-readable summary

Global Options:
  --profile <name>    AWS profile to use
  --region <region>   AWS region (default: us-east-1)
  --verbose           Enable debug logging
  --output <format>   Output format: json|yaml|table (default: json)
```

### Command Details:

```bash
# Observe agent behavior
agentic-iam observe \
  --role-arn arn:aws:iam::123456789012:role/MyAgentRole \
  --days 7 \
  --include-data-events

# Generate policy
agentic-iam generate \
  --role-arn arn:aws:iam::123456789012:role/MyAgentRole \
  --format json \
  --output ./generated-policy.json \
  --max-statements 10

# Check drift
agentic-iam drift \
  --role-arn arn:aws:iam::123456789012:role/MyAgentRole \
  --threshold medium \
  --since 2024-01-01

# Self-update
agentic-iam update --source botocore

# Full report
agentic-iam report \
  --role-arn arn:aws:iam::123456789012:role/MyAgentRole \
  --format markdown
```

## 4. Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| CLI | TypeScript + Commander.js | Type safety, AWS SDK v3 native |
| Storage | SQLite (better-sqlite3) | Zero-config, portable, fast |
| AWS SDK | @aws-sdk/client-* v3 | Modular, tree-shakeable |
| Infrastructure | AWS CDK (TypeScript) | Same language as app |
| Policy Validation | IAM Policy Simulator API | Official validation |
| Self-Update | GitHub API + botocore | Authoritative source |
| Testing | Vitest | Fast, TypeScript-native |

## 5. Data Flow Diagram

```
Developer runs: `agentic-iam observe --role-arn <arn>`
         │
         ▼
┌──────────────────┐     ┌─────────────────┐
│ CloudTrail       │────▶│ LookupEvents API│
│ (last N days)    │     │ (filtered)      │
└──────────────────┘     └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ Parse & Dedupe  │
                         │ - Extract action│
                         │ - Extract ARN   │
                         │ - Store locally │
                         └────────┬────────┘
                                  │
                                  ▼
Developer runs: `agentic-iam generate`
         │
         ▼
┌──────────────────┐     ┌─────────────────┐
│ Read observations│────▶│ Build policy    │
│ from SQLite      │     │ - Group actions │
│                  │     │ - Scope resources│
└──────────────────┘     │ - Add conditions│
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ Validate policy │
                         │ - Size check    │
                         │ - Grammar check │
                         │ - Simulate      │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ Output          │
                         │ - JSON file     │
                         │ - Stdout        │
                         │ - PR-ready diff │
                         └─────────────────┘
```

## 6. Security Considerations

1. **Minimum tool permissions**: The tool itself needs only:
   - `cloudtrail:LookupEvents` (read-only)
   - `iam:GetPolicy`, `iam:GetPolicyVersion`, `iam:ListAttachedRolePolicies` (read-only)
   - `iam:SimulateCustomPolicy` (for validation)
   - No write permissions to IAM (policy application is manual/CI)

2. **Local data**: SQLite DB contains action names and resource ARNs — no secrets, no request/response bodies

3. **Credential handling**: Uses standard AWS credential chain (env vars → profile → instance role)

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| CloudTrail not enabled | Error with setup instructions |
| No events found | Warning + suggest longer observation window |
| Policy size exceeds limit | Split into multiple policies with guidance |
| Rate limiting | Exponential backoff with jitter |
| Stale action DB | Warning + prompt to run `update` |

## 8. Future Extensions (v2+)

- Real-time mode via CloudTrail Lake queries
- Integration with AWS Access Analyzer for automated validation
- GitHub Actions / GitLab CI integration for drift alerts
- Multi-account support via Organizations
- Policy recommendation engine (suggest conditions based on patterns)
