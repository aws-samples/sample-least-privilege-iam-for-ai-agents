# Hook: On-Commit Trace Format Compatibility

## Trigger
- Event: pre-commit
- Condition: files in `src/tracer/` modified

## Action
When committing changes to the trace collector:
1. Verify Bedrock Agent trace format parsing still works with test fixtures
2. Check that LangChain callback interface contract is maintained
3. Ensure new trace step types are handled in the analyzer and renderer
4. Validate DynamoDB schema compatibility (no breaking changes to existing items)

## Implementation
```bash
#!/bin/bash
TRACER_FILES=$(git diff --cached --name-only | grep 'src/tracer/')

if [ -n "$TRACER_FILES" ]; then
  echo "🔍 Checking trace format compatibility..."
  npx vitest run --filter "format-compat"
  
  if [ $? -ne 0 ]; then
    echo "❌ Trace format compatibility tests failed."
    exit 1
  fi
  echo "✅ Trace format compatibility verified."
fi
```

## Rationale
The tracer must handle multiple agent frameworks. Breaking changes to parsing logic could silently drop trace data from production agents.
