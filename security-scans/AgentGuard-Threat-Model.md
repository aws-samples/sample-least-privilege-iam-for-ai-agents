# AgentGuard — Threat Model

**Content:** APG pattern "Continuous least-privilege IAM for non-deterministic AI agents using CloudTrail"
**Project:** AgentGuard
**Audience:** External (AWS Prescriptive Guidance Library)
**Classification:** Sample code, non-production
**Methodology:** Adam Shostack's 4-Question Frame + STRIDE
**Author:** Tarun Kumar (tarrych)
**Date:** 2026-08-17

> **Disclaimer:** This is sample code for non-production usage. Users should
> work with their security and legal teams to meet their organizational
> security, regulatory, and compliance requirements before deployment.

---

## 1. What are we building?

AgentGuard is a serverless observation pipeline that continuously captures the
AWS API calls made by an AI agent's IAM role (via CloudTrail), and a local CLI
that generates least-privilege IAM policies and detects permission drift from
the collected observations.

### Deployed components (CDK stack `AgenticIamStack`)

| Element | Type | Description |
|---|---|---|
| CloudTrail Trail | Process | Records management (and optional data) events |
| S3 `TrailBucket` | Data store | CloudTrail log destination; SSE-S3, block-all-public, SSL-enforced, versioned, access-logged |
| S3 `AccessLogBucket` | Data store | Server access logs for the trail bucket |
| EventBridge Rule | Process | Filters events where `userIdentity.arn` prefix-matches the agent role ARN |
| Lambda `CollectorFn` | Process | Normalizes matched events (service, action, resource ARN, timestamp) and logs them; read-only `cloudtrail:LookupEvents` |
| IAM `AgenticIamToolRole` | External entity (assumed by CLI) | Read-only role for the CLI: scoped IAM reads + CloudTrail lookups |

### Off-AWS / local components

| Element | Type | Description |
|---|---|---|
| `agentic-iam` CLI | External entity | Runs on an operator workstation; reads observations, generates policies, detects drift |
| Local action DB | Data store | `~/.agentic-iam/action-db/actions.json` — IAM action reference |
| Self-update module | Process | Fetches botocore service model definitions over HTTPS from `raw.githubusercontent.com` |

### Data Flow Diagram (textual)

```
[AI Agent role] --API calls--> (CloudTrail) --events--> (EventBridge Rule)
   --matched events--> (CollectorFn Lambda) --normalized obs--> [S3 TrailBucket / CloudWatch Logs]

[Operator] --runs--> (agentic-iam CLI) --assumes--> {AgenticIamToolRole}
   (CLI) --reads--> [S3 observations] + [target role IAM policies]
   (CLI) --generates--> [least-privilege policy.json] (local)
   (Self-update) --HTTPS GET--> {github raw botocore} --> [local action DB]
```
Trust boundaries: (a) AWS account boundary; (b) operator workstation boundary;
(c) the public internet call to GitHub.

### Assets (C/I/A impact)

| # | Asset | Confidentiality | Integrity | Availability |
|---|---|---|---|---|
| AS1 | CloudTrail observation data (API call metadata: service, action, resource ARN, timestamp) | Medium | High | Low |
| AS2 | Generated IAM policy documents | Low | **High** (a wrong policy can over- or under-grant) | Low |
| AS3 | The agent's IAM role and its permissions | High | **High** | Medium |
| AS4 | Local IAM action database | Low | Medium | Low |
| AS5 | The `AgenticIamToolRole` credentials | **High** | High | Low |

**Note:** No PII, secrets, or agent credentials are collected — only API call
metadata.

---

## 2. What can go wrong? (attacker goals + STRIDE threats)

### High-level attacker goals
- **G1:** Escalate privilege by influencing the generated IAM policy.
- **G2:** Read sensitive information about the account's API activity.
- **G3:** Tamper with the observation data or action database to weaken policies.
- **G4:** Abuse the outbound internet dependency (supply chain).
- **G5:** Disrupt the observation pipeline to create policy blind spots.

### Threats and mitigations

| # | STRIDE | Threat | Goal | Mitigation | Type |
|---|---|---|---|---|---|
| T1 | Tampering / EoP | A compromised or spoofed botocore/GitHub response injects bogus or malicious "actions" into the local DB, skewing generated policies (over-grant). | G1,G3,G4 | HTTPS/TLS to `raw.githubusercontent.com` (integrity in transit). Action DB is advisory only; **generated policies are based solely on *observed* CloudTrail actions, not the DB** — so a poisoned DB cannot by itself add permissions. Reviewer guidance: pin/verify source; consider checksum. | Preventative / Technical |
| T2 | Info Disclosure | Observation data (which APIs the agent calls, on which resources) leaks to an unauthorized party via the S3 bucket. | G2 | S3 SSE-S3 encryption at rest, `BLOCK_ALL` public access, `enforceSSL` (deny non-TLS), versioning, and server access logging. Bucket policy restricts to deployed roles. | Preventative / Technical |
| T3 | Elevation of Privilege | An operator applies a generated policy that is broader than intended (e.g., resource `*` fallback where ARN was absent), granting the agent excess permissions. | G1 | Pattern documents that generated policies are **recommendations, not auto-applied**; requires human review; drift detector flags over-permissioned actions; `validatePolicy()` enforces IAM size/statement limits. **Residual risk accepted — documented as a Best Practice ("Review generated policies before applying").** | Administrative / Corrective |
| T4 | Info Disclosure | The `CollectorFn` or `AgenticIamToolRole` is over-permissioned and can read more than intended. | G2,G5 | Collector has only `cloudtrail:LookupEvents` (read-only; service requires `*`). Tool role IAM reads scoped to account `role/*` and `policy/*`; `SimulateCustomPolicy` requires `*` (custom mode, evaluates passed-in strings, returns no account data). All wildcards documented via cdk-nag suppressions with evidence. No write/PassRole/privilege-escalation actions. | Preventative / Technical |
| T5 | Tampering | An actor with S3 write access modifies stored observations to hide API usage, causing under-permissioned (denied) or falsely-narrowed policies. | G3,G5 | S3 versioning retains prior object versions; bucket access logging provides an audit trail; access restricted to deployed roles. Drift detector's "under-permissioned" category surfaces missing permissions post-apply. | Detective / Technical |
| T6 | Denial of Service | High agent activity throttles/overwhelms `CollectorFn`, creating gaps in observation → incomplete policy. | G5 | `reservedConcurrentExecutions: 10`; pattern documents adding an SQS buffer for >1,000 events/min; CloudWatch alarm on Lambda errors recommended. Availability impact of AS1 rated Low (analysis is not real-time). | Preventative / Detective |
| T7 | Spoofing | Events from a non-agent principal are mis-attributed to the agent role (e.g., assumed-role session names, cross-account STS chains). | G1,G3 | EventBridge pattern prefix-matches `userIdentity.arn` to the agent role ARN; pattern documents the cross-account STS limitation explicitly. Residual risk documented as a Limitation. | Preventative / Administrative |
| T8 | Repudiation | Actions taken by the tool role cannot be attributed. | — | All API calls by `AgenticIamToolRole` and `CollectorFn` are themselves recorded in CloudTrail; S3 access logging enabled. | Detective / Technical |
| T9 | Tampering (supply chain) | A malicious npm dependency is introduced. | G4 | Dependencies pinned to exact versions; `npm audit` run with 0 vulnerabilities across all packages; Semgrep static analysis 0 findings; cdk-nag 0 findings. | Preventative / Detective |

---

## 3. What are we doing about it? (summary of controls)

- **Encryption:** SSE-S3 at rest on all buckets; SSL enforced in transit; HTTPS-only for the GitHub fetch.
- **Access control:** Least-privilege, read-only IAM; wildcards limited to service-required actions, each documented with evidence.
- **Detection/audit:** S3 access logging, S3 versioning, CloudTrail coverage of the tool's own actions, drift detection.
- **Supply chain:** pinned deps, `npm audit` clean, Semgrep clean, cdk-nag clean.
- **Administrative:** "review before apply" is a documented Best Practice; non-production disclaimer included.

### Scanner evidence (attached to the PCSR ticket)
- `security-scans/cdk-nag-output.txt` — 0 errors, 0 warnings
- `security-scans/semgrep-output.txt` / `.json` — 0 findings
- `security-scans/npm-audit-output.txt` — 0 vulnerabilities (all packages)

---

## 4. Did we do a good enough job (for now)?

- Coverage: all deployed resources and the local/off-AWS components are modeled.
- Residual risks explicitly accepted and documented in the pattern: T3 (human
  applies generated policy), T7 (cross-account STS attribution).
- **Open item for the Guardian:** this pattern provides IAM/authorization
  guidance and references compliance standards (SOC 2, FedRAMP, PCI DSS) in its
  problem statement. Per the SMGS Security Review Criteria, that may trigger an
  AWS AppSec escalation clause. Confirm PCSR vs. AppSec routing before review.
