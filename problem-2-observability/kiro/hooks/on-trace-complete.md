# Hook: On-Trace-Complete Analysis

## Trigger
- Event: trace completion (TraceCollector.completeTrace() called)

## Action
When a trace is completed:
1. Run ReasoningAnalyzer on the completed trace
2. Evaluate all alert rules against the analysis
3. If any alerts fire, log to console and send notifications
4. Store coherence score in trace metadata
5. If coherence < 0.5, flag for human review

## Implementation
```typescript
collector.onTraceComplete(async (trace) => {
  const analyzer = new ReasoningAnalyzer();
  const analysis = analyzer.analyzeTrace(trace);
  
  trace.coherenceScore = analysis.coherenceScore;
  await store.saveTrace(trace);
  
  const alerts = await alertEngine.evaluate(trace, analysis);
  if (alerts.length > 0) {
    console.warn(`[AgentTracer] Alerts fired: ${alerts.join(", ")}`);
  }
});
```

## Rationale
Automated analysis on every trace ensures issues are caught immediately, not discovered during manual review hours later.
