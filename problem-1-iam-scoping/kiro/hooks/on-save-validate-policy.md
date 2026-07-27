# Hook: On-Save Policy Validation

## Trigger
- File pattern: `**/*.json` (policy output files)
- Event: file save

## Action
When a policy JSON file is saved:
1. Parse the JSON and validate it's a valid IAM policy structure
2. Check for `"Action": "*"` — flag as critical security issue
3. Check for `"Resource": "*"` — flag as warning (acceptable only for certain actions)
4. Validate policy size < 6,144 non-whitespace characters (managed policy limit)
5. Ensure all actions use `service:Action` format
6. Report validation results inline

## Implementation
```typescript
import { IAMPolicy } from "../src/types";

export function validatePolicyOnSave(content: string): ValidationResult {
  const policy: IAMPolicy = JSON.parse(content);
  const issues: string[] = [];

  for (const stmt of policy.Statement) {
    if (stmt.Action.includes("*")) {
      issues.push(`CRITICAL: Statement "${stmt.Sid}" uses wildcard action`);
    }
    if (stmt.Resource.includes("*") && !isWildcardAcceptable(stmt.Action)) {
      issues.push(`WARNING: Statement "${stmt.Sid}" uses wildcard resource`);
    }
  }

  if (JSON.stringify(policy).length > 6144) {
    issues.push("ERROR: Policy exceeds 6,144 character managed policy limit");
  }

  return { valid: issues.length === 0, issues };
}
```
