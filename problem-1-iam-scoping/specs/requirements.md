# Problem 1: Agentic IAM Policy Generator — Requirements Specification

## Problem Statement

When developers deploy AI agents (Bedrock Agents, LangChain agents, custom orchestrators) on AWS, they face a fundamental security dilemma: agents make non-deterministic API calls based on user input and model reasoning, making it impossible to predict the exact set of IAM permissions needed upfront.

The result:
- Developers grant overly broad permissions (`Action: "*"`) to avoid breaking agent workflows
- Security teams can't audit what agents actually need vs. what they're granted
- Policy drift occurs silently when agent behavior changes (new model versions, updated tools)

## Target Users

1. **Application developers** deploying AI agents on AWS
2. **Platform/DevOps engineers** managing agent infrastructure
3. **Security engineers** auditing agent permissions

## Use Case

> A developer deploys a Bedrock Agent with tools for DynamoDB queries, Lambda invocations, and SNS notifications. Instead of manually crafting IAM policies or granting `*`, this tool:
> 1. Observes the agent's actual API calls over N runs via CloudTrail
> 2. Generates a minimal least-privilege IAM policy
> 3. Detects drift when agent behavior changes
> 4. Outputs PR-ready policy JSON for CI/CD integration

## Functional Requirements

### FR-1: Observation Mode
- **FR-1.1**: Collect CloudTrail events filtered by a specific IAM role ARN (the agent's execution role)
- **FR-1.2**: Extract service name, action, and resource ARN from each event
- **FR-1.3**: Support configurable observation window (default: 7 days)
- **FR-1.4**: Deduplicate actions across multiple invocations
- **FR-1.5**: Store observations in a local SQLite database for offline analysis

### FR-2: Policy Generation
- **FR-2.1**: Generate minimal IAM policy JSON from observed actions
- **FR-2.2**: Apply resource-level scoping (use specific ARNs, not `*`)
- **FR-2.3**: Group actions by service for readability
- **FR-2.4**: Support condition keys where applicable (e.g., `aws:SourceArn`)
- **FR-2.5**: Validate generated policy against AWS IAM policy grammar
- **FR-2.6**: Output policy in standard AWS JSON format

### FR-3: Drift Detection
- **FR-3.1**: Compare currently attached IAM policy against observed behavior
- **FR-3.2**: Identify over-permissioned actions (granted but never used)
- **FR-3.3**: Identify under-permissioned actions (used but not granted — implicit denies)
- **FR-3.4**: Detect new actions that appeared after initial policy generation
- **FR-3.5**: Generate drift report with severity classification

### FR-4: Self-Update
- **FR-4.1**: Pull latest IAM action definitions from AWS documentation/SDK
- **FR-4.2**: Detect deprecated actions and suggest replacements
- **FR-4.3**: Update internal action database without code changes
- **FR-4.4**: Version the action database with timestamps

### FR-5: CLI Interface
- **FR-5.1**: `observe --role-arn <arn> [--days 7] [--region us-east-1]`
- **FR-5.2**: `generate [--format json|yaml|terraform] [--output file]`
- **FR-5.3**: `drift [--role-arn <arn>] [--alert-threshold high|medium|low]`
- **FR-5.4**: `update` — refresh action database
- **FR-5.5**: `report` — generate human-readable summary

## Non-Functional Requirements

### NFR-1: Performance
- Observation collection must handle 10,000+ CloudTrail events without timeout
- Policy generation must complete in < 5 seconds for typical workloads

### NFR-2: Security
- Tool must never require more permissions than it grants
- Local database must not store sensitive credentials
- All AWS API calls must use STS temporary credentials

### NFR-3: Extensibility
- Plugin architecture for custom policy formats (Terraform, CloudFormation, CDK)
- Support for custom action mappings beyond AWS defaults

### NFR-4: Reliability
- Graceful handling of CloudTrail delivery delays (up to 15 min)
- Idempotent observation runs (re-running doesn't duplicate data)

## Acceptance Criteria

1. Given an agent role ARN, the tool collects all API calls made by that role in the specified window
2. Generated policy passes `aws iam simulate-custom-policy` validation
3. Drift detection correctly identifies actions present in policy but never observed
4. Self-update pulls new actions within 24 hours of AWS releasing them
5. End-to-end flow completes in under 60 seconds for a typical agent with 5 tools

## Out of Scope (v1)

- Cross-account role assumption tracking
- Real-time streaming (batch processing only)
- GUI/web interface
- Multi-cloud support
