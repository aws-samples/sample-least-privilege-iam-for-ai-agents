# Steering: Agent Reasoning Tracer Project

## Code Conventions
- TypeScript strict mode, ES modules
- All AWS SDK calls use v3 modular clients
- Async/await for all I/O operations (no callbacks)
- Use `chalk` for terminal output coloring

## Privacy & Security Rules
- ALL trace data must pass through PII redaction before storage
- Never store raw prompts/responses unless user explicitly opts in via `--store-raw` flag
- DynamoDB items must always include TTL field
- Encryption at rest via AWS-managed KMS (default DynamoDB encryption)
- Access control: traces are scoped by roleArn — never expose cross-role data

## Observability Best Practices
- Trace collection overhead must be < 5% of agent execution time
- Use async buffering for trace writes (don't block agent execution)
- Graceful degradation: if tracing fails, agent continues normally
- All metrics use "AgentTracer" CloudWatch namespace

## Analysis Heuristics
- Coherence scoring uses word overlap + bigram similarity (no external LLM calls)
- Loop detection uses sliding window of 10 steps with hash comparison
- Hallucination detection compares tool output facts against LLM claims
- Confidence estimation uses hedging language detection

## Testing Requirements
- Mock DynamoDB and CloudWatch in all tests
- Test PII redaction with known patterns (email, phone, SSN, credit card)
- Test loop detection with synthetic traces containing known loops
- Test coherence scoring with high/low coherence examples
