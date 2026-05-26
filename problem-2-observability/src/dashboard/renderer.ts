import { AgentTrace, DiffResult } from "../types.js";
import chalk from "chalk";

export class TerminalRenderer {
  renderTrace(trace: AgentTrace): string {
    const lines: string[] = [];
    const width = 60;

    lines.push(chalk.bold(`┌─ Trace: ${trace.traceId.slice(0, 8)} ${"─".repeat(width - 20)}┐`));
    lines.push(`│  Session: ${trace.sessionId.slice(0, 8)}  Status: ${this.statusColor(trace.status)}  │`);
    lines.push(`│${"─".repeat(width)}│`);

    for (let i = 0; i < trace.steps.length; i++) {
      const step = trace.steps[i];
      const icon = this.stepIcon(step.type);
      const color = this.stepColor(step.type);

      lines.push(`│  ${i > 0 ? "  │" : ""}${" ".repeat(Math.max(0, width - 5))}│`);
      lines.push(`│  ${i > 0 ? "  ▼" : ""}${" ".repeat(Math.max(0, width - 5))}│`);
      lines.push(`│  ${color(`[${icon}] ${step.input.summary.slice(0, 45)}`)}${" ".repeat(Math.max(0, 5))}│`);

      const meta: string[] = [];
      if (step.tokenCount > 0) meta.push(`tokens: ${step.tokenCount}`);
      if (step.durationMs > 0) meta.push(`${step.durationMs}ms`);
      if (step.confidence !== undefined) meta.push(`conf: ${(step.confidence * 100).toFixed(0)}%`);
      if (step.error) meta.push(chalk.red(`ERR: ${step.error.slice(0, 20)}`));

      if (meta.length > 0) {
        lines.push(`│     ${chalk.dim(meta.join(" | "))}${" ".repeat(Math.max(0, width - meta.join(" | ").length - 7))}│`);
      }
    }

    lines.push(`│${"─".repeat(width)}│`);
    lines.push(`│  Total: ${trace.totalTokens} tokens | ${trace.totalLatencyMs}ms | Coherence: ${(trace.coherenceScore || 0).toFixed(2)}  │`);
    lines.push(`└${"─".repeat(width)}┘`);

    return lines.join("\n");
  }

  renderWaterfall(trace: AgentTrace): string {
    const lines: string[] = [];
    const maxMs = trace.totalLatencyMs || 1;
    const barWidth = 40;

    lines.push(chalk.bold("\nTiming Waterfall:"));
    lines.push(`${"Step".padEnd(20)} ${"0ms".padEnd(10)} ${(maxMs / 2 + "ms").padEnd(10)} ${maxMs}ms`);
    lines.push("─".repeat(70));

    let elapsed = 0;
    for (const step of trace.steps) {
      const label = `${this.stepIcon(step.type)} ${step.type}`.slice(0, 18).padEnd(20);
      const startPos = Math.floor((elapsed / maxMs) * barWidth);
      const width = Math.max(1, Math.floor((step.durationMs / maxMs) * barWidth));

      const bar = " ".repeat(startPos) + this.stepColor(step.type)("█".repeat(width)) + " ".repeat(Math.max(0, barWidth - startPos - width));
      lines.push(`${label} ${bar}  ${step.durationMs}ms`);
      elapsed += step.durationMs;
    }

    lines.push("─".repeat(70));
    return lines.join("\n");
  }

  renderDiff(diff: DiffResult): string {
    const lines: string[] = [];

    lines.push(chalk.bold("\nTrace Comparison:"));
    lines.push(`Trace A: ${diff.traceA.stepCount} steps, ${diff.traceA.totalTokens} tokens`);
    lines.push(`Trace B: ${diff.traceB.stepCount} steps, ${diff.traceB.totalTokens} tokens`);
    lines.push(`Divergence at step: ${diff.divergenceStep}`);
    lines.push("─".repeat(70));

    for (const d of diff.differences) {
      const marker = d.status === "equal" ? chalk.green("=") : d.status === "different" ? chalk.red("≠") : d.status === "added" ? chalk.yellow("+") : chalk.red("-");

      const labelA = d.stepA ? `${d.stepA.type}: ${d.stepA.input.summary.slice(0, 25)}` : "";
      const labelB = d.stepB ? `${d.stepB.type}: ${d.stepB.input.summary.slice(0, 25)}` : "";

      lines.push(`  ${marker} ${labelA.padEnd(30)} | ${labelB}`);
    }

    if (diff.divergenceStep < Math.max(diff.traceA.stepCount, diff.traceB.stepCount)) {
      lines.push(chalk.yellow(`\n  ← DIVERGENCE at step ${diff.divergenceStep}: Different reasoning path`));
    }

    return lines.join("\n");
  }

  private stepIcon(type: string): string {
    switch (type) {
      case "llm-call": return "LLM";
      case "tool-call": return "TOOL";
      case "decision": return "DEC";
      default: return "→";
    }
  }

  private stepColor(type: string): (s: string) => string {
    switch (type) {
      case "llm-call": return chalk.cyan;
      case "tool-call": return chalk.green;
      case "decision": return chalk.yellow;
      default: return chalk.white;
    }
  }

  private statusColor(status: string): string {
    switch (status) {
      case "complete": return chalk.green(status);
      case "failed": return chalk.red(status);
      case "timeout": return chalk.yellow(status);
      default: return chalk.blue(status);
    }
  }
}
