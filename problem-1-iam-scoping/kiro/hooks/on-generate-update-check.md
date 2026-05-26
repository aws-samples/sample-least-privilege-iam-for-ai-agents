# Hook: On-Generate Auto-Update Check

## Trigger
- Event: before `agentic-iam generate` command execution
- Condition: action database is older than 7 days

## Action
Before generating a policy:
1. Check the action database `metadata.json` for `lastUpdated` timestamp
2. If older than 7 days, prompt user to run `agentic-iam update`
3. If older than 30 days, warn that generated policy may reference deprecated actions
4. Log the database version used in the generated policy metadata

## Rationale
AWS adds ~50 new IAM actions per month. A stale action database means:
- Generated policies might miss new fine-grained actions
- Wildcard expansion won't cover recently added actions
- Deprecated actions won't be flagged

## Implementation
```typescript
export function checkActionDbFreshness(): { stale: boolean; daysSinceUpdate: number } {
  const metadata = readMetadata();
  const lastUpdated = new Date(metadata.lastUpdated);
  const daysSince = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));
  return { stale: daysSince > 7, daysSinceUpdate: daysSince };
}
```
