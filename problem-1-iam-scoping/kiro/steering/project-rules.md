# Steering: IAM Policy Generator Project

## Code Conventions
- Use TypeScript strict mode for all source files
- Use ES modules (import/export), not CommonJS
- All AWS SDK calls must use v3 modular clients
- Error handling: wrap all AWS API calls in try/catch with typed errors
- Use `chalk` for CLI output coloring (green=success, red=error, yellow=warning, blue=info)

## IAM Best Practices (enforced in generated policies)
- Never generate policies with `"Action": "*"` or `"Resource": "*"` unless explicitly confirmed
- Always scope resources to specific ARNs when available
- Group actions by service in separate statements for readability
- Include `Sid` on every statement for traceability
- Prefer managed policies over inline policies in recommendations

## Security Rules
- Never store AWS credentials in code or local database
- SQLite database must only contain action names and resource ARNs, never request/response bodies
- All temporary credentials must use STS with session duration < 1 hour
- Generated policies must pass size validation before output

## Testing Requirements
- Every new function must have a corresponding unit test
- Mock all AWS SDK calls in tests (never make real API calls in CI)
- Test edge cases: empty observations, wildcard expansion, policy size limits

## File Organization
- Types in `src/types.ts`
- AWS interactions in `src/collector/`
- Business logic in `src/engine/`
- CLI commands in `src/cli/`
- Infrastructure in `infra/`
