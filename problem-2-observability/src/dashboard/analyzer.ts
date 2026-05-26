import { AgentTrace, AnalysisResult, LoopInfo, HallucinationInfo, DiffResult, StepDiff } from "../types.js";

export class ReasoningAnalyzer {
  analyzeTrace(trace: AgentTrace): AnalysisResult {
    const coherenceScore = this.scoreCoherence(trace);
    const loopsDetected = this.detectLoops(trace);
    const hallucinations = this.detectHallucinations(trace);
    const criticalPath = this.findCriticalPath(trace);
    const totalCost = this.estimateCost(trace);

    return {
      traceId: trace.traceId,
      coherenceScore,
      loopsDetected,
      hallucinations,
      criticalPath,
      totalCost,
    };
  }

  private scoreCoherence(trace: AgentTrace): number {
    if (trace.steps.length < 2) return 1.0;

    let totalScore = 0;
    let pairs = 0;

    for (let i = 1; i < trace.steps.length; i++) {
      const prev = trace.steps[i - 1];
      const curr = trace.steps[i];

      // Check if current step references previous output
      const prevOutput = prev.output.summary.toLowerCase();
      const currInput = curr.input.summary.toLowerCase();

      if (this.hasDirectReference(prevOutput, currInput)) {
        totalScore += 1.0;
      } else if (this.hasSemanticsOverlap(prevOutput, currInput)) {
        totalScore += 0.7;
      } else if (prev.type === "tool-call" && curr.type === "llm-call") {
        // Tool → LLM is expected flow
        totalScore += 0.9;
      } else {
        totalScore += 0.3;
      }
      pairs++;
    }

    return pairs > 0 ? totalScore / pairs : 1.0;
  }

  private hasDirectReference(output: string, input: string): boolean {
    // Check if key terms from output appear in input
    const outputWords = new Set(output.split(/\s+/).filter((w) => w.length > 4));
    const inputWords = new Set(input.split(/\s+/).filter((w) => w.length > 4));
    const overlap = [...outputWords].filter((w) => inputWords.has(w));
    return overlap.length / Math.max(outputWords.size, 1) > 0.3;
  }

  private hasSemanticsOverlap(a: string, b: string): boolean {
    // Simple bigram overlap as semantic proxy
    const bigramsA = this.getBigrams(a);
    const bigramsB = this.getBigrams(b);
    const overlap = bigramsA.filter((bg) => bigramsB.includes(bg));
    return overlap.length / Math.max(bigramsA.length, 1) > 0.2;
  }

  private getBigrams(text: string): string[] {
    const words = text.split(/\s+/);
    return words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`);
  }

  private detectLoops(trace: AgentTrace): LoopInfo[] {
    const loops: LoopInfo[] = [];
    const hashWindow: Array<{ hash: string; stepId: string; tokens: number }> = [];

    for (const step of trace.steps) {
      const hash = `${step.type}:${step.input.summary.slice(0, 50)}`;
      hashWindow.push({ hash, stepId: step.stepId, tokens: step.tokenCount });

      // Check for repeated patterns
      const matching = hashWindow.filter((h) => h.hash === hash);
      if (matching.length >= 3) {
        loops.push({
          stepIds: matching.map((m) => m.stepId),
          pattern: hash,
          wastedTokens: matching.slice(1).reduce((sum, m) => sum + m.tokens, 0),
        });
      }

      // Keep window at 10
      if (hashWindow.length > 10) hashWindow.shift();
    }

    return loops;
  }

  private detectHallucinations(trace: AgentTrace): HallucinationInfo[] {
    const hallucinations: HallucinationInfo[] = [];

    for (let i = 1; i < trace.steps.length; i++) {
      const prev = trace.steps[i - 1];
      const curr = trace.steps[i];

      // Check: tool returns data, LLM claims something not in the data
      if (prev.type === "tool-call" && curr.type === "llm-call" && !prev.error) {
        const toolOutput = prev.output.summary.toLowerCase();
        const llmClaims = curr.output.summary.toLowerCase();

        // Simple contradiction check: negation of tool output
        if (toolOutput.includes("not found") && !llmClaims.includes("not found") && !llmClaims.includes("unavailable")) {
          hallucinations.push({
            stepId: curr.stepId,
            claim: curr.output.summary.slice(0, 100),
            evidence: `Tool returned "not found" but agent did not acknowledge this`,
            severity: "critical",
          });
        }

        // Check if agent fabricates numbers not in tool output
        const numbersInLLM = llmClaims.match(/\d+\.?\d*/g) || [];
        const numbersInTool = toolOutput.match(/\d+\.?\d*/g) || [];
        const fabricated = numbersInLLM.filter((n) => !numbersInTool.includes(n) && n.length > 2);
        if (fabricated.length > 0) {
          hallucinations.push({
            stepId: curr.stepId,
            claim: `Contains numbers (${fabricated.join(", ")}) not present in tool output`,
            evidence: `Tool output numbers: ${numbersInTool.join(", ")}`,
            severity: "minor",
          });
        }
      }
    }

    return hallucinations;
  }

  private findCriticalPath(trace: AgentTrace): string[] {
    // Critical path = steps that took the most time (>20% of total)
    const totalMs = trace.totalLatencyMs || trace.steps.reduce((s, step) => s + step.durationMs, 0);
    const threshold = totalMs * 0.2;
    return trace.steps.filter((s) => s.durationMs > threshold).map((s) => s.stepId);
  }

  private estimateCost(trace: AgentTrace): { inputTokens: number; outputTokens: number; estimatedCostUsd: number } {
    let inputTokens = 0;
    let outputTokens = 0;

    for (const step of trace.steps) {
      if (step.type === "llm-call") {
        inputTokens += step.input.tokenCount;
        outputTokens += step.output.tokenCount;
      }
    }

    // Approximate pricing (Claude 3 Sonnet-level)
    const costPer1kInput = 0.003;
    const costPer1kOutput = 0.015;
    const estimatedCostUsd = (inputTokens / 1000) * costPer1kInput + (outputTokens / 1000) * costPer1kOutput;

    return { inputTokens, outputTokens, estimatedCostUsd };
  }

  diffTraces(traceA: AgentTrace, traceB: AgentTrace): DiffResult {
    const differences: StepDiff[] = [];
    const maxLen = Math.max(traceA.steps.length, traceB.steps.length);
    let divergenceStep = -1;

    for (let i = 0; i < maxLen; i++) {
      const stepA = traceA.steps[i];
      const stepB = traceB.steps[i];

      if (!stepA) {
        differences.push({ stepIndex: i, status: "added", stepB });
      } else if (!stepB) {
        differences.push({ stepIndex: i, status: "removed", stepA });
      } else if (stepA.type === stepB.type && stepA.input.summary === stepB.input.summary) {
        differences.push({ stepIndex: i, status: "equal", stepA, stepB });
      } else {
        if (divergenceStep === -1) divergenceStep = i;
        differences.push({ stepIndex: i, status: "different", stepA, stepB });
      }
    }

    return {
      divergenceStep: divergenceStep === -1 ? maxLen : divergenceStep,
      traceA: {
        stepCount: traceA.steps.length,
        totalTokens: traceA.totalTokens,
        path: traceA.steps.map((s) => `${s.type}:${s.input.summary.slice(0, 30)}`),
      },
      traceB: {
        stepCount: traceB.steps.length,
        totalTokens: traceB.totalTokens,
        path: traceB.steps.map((s) => `${s.type}:${s.input.summary.slice(0, 30)}`),
      },
      differences,
    };
  }
}
