# Hook: On-Commit Drift Detection

## Trigger
- Event: pre-commit
- Condition: any file in `infra/` or policy JSON files modified

## Action
When committing changes that affect IAM policies or infrastructure:
1. Run drift detection against the last known observation baseline
2. If new permissions are being added, verify they were observed in CloudTrail
3. If permissions are being removed, check they haven't been used in the last 7 days
4. Block commit if high-severity drift is detected without explicit override

## Workflow
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check if policy files changed
POLICY_FILES=$(git diff --cached --name-only | grep -E '\.json$|infra/')

if [ -n "$POLICY_FILES" ]; then
  echo "🔍 Running drift detection on changed policies..."
  
  # Run drift check
  npx tsx src/cli/index.ts drift \
    --role-arn "$AGENT_ROLE_ARN" \
    --threshold high
  
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -ne 0 ]; then
    echo "❌ High-severity drift detected. Use --no-verify to override."
    exit 1
  fi
  
  echo "✅ No high-severity drift detected."
fi
```

## Override
Developers can bypass with `git commit --no-verify` but this is logged for audit.
