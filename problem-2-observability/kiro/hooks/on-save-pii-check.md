# Hook: On-Save PII Check

## Trigger
- File pattern: `**/*.ts` (source files in tracer/)
- Event: file save

## Action
When a source file is saved:
1. Scan for hardcoded strings that look like PII (emails, ARNs with account IDs, etc.)
2. Check that any new string literals in trace-handling code go through redaction
3. Verify no `console.log` of raw trace data without redaction
4. Flag test files that contain real-looking PII (should use synthetic data)

## Rules
- Any string matching email/phone/SSN patterns in non-test code → ERROR
- Any `console.log(trace)` or `console.log(step)` without `.summary` → WARNING
- Test files must use `@example.com` domains and `555-` phone prefixes

## Rationale
Prevents accidental PII leakage in logs or stored traces. Privacy compliance is non-negotiable for a tracing tool that captures LLM inputs/outputs.
