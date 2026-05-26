#!/usr/bin/env node
import { Command } from "commander";
import { TraceStore } from "../tracer/store.js";
import { ReasoningAnalyzer } from "../dashboard/analyzer.js";
import { TerminalRenderer } from "../dashboard/renderer.js";
import { AlertEngine } from "../alerting/alert-engine.js";
import chalk from "chalk";

const program = new Command();

program
  .name("agent-tracer")
  .description("Agent Reasoning Tracer — Observability for AI Agents")
  .version("1.0.0");

program
  .command("trace")
  .description("View a specific agent session trace")
  .requiredOption("--trace-id <id>", "Trace ID to view")
  .option("--region <region>", "AWS region", "us-east-1")
  .action(async (opts) => {
    const store = new TraceStore(opts.region);
    const renderer = new TerminalRenderer();

    const trace = await store.getTrace(opts.traceId);
    if (!trace) {
      console.error(chalk.red(`✗ Trace not found: ${opts.traceId}`));
      process.exit(1);
    }

    // Analyze
    const analyzer = new ReasoningAnalyzer();
    const analysis = analyzer.analyzeTrace(trace);
    trace.coherenceScore = analysis.coherenceScore;

    // Render
    console.log(renderer.renderTrace(trace));
    console.log(renderer.renderWaterfall(trace));

    if (analysis.loopsDetected.length > 0) {
      console.log(chalk.yellow(`\n⚠ ${analysis.loopsDetected.length} reasoning loop(s) detected`));
      for (const loop of analysis.loopsDetected) {
        console.log(chalk.yellow(`  Pattern: ${loop.pattern} (${loop.wastedTokens} tokens wasted)`));
      }
    }

    if (analysis.hallucinations.length > 0) {
      console.log(chalk.red(`\n⚠ ${analysis.hallucinations.length} potential hallucination(s)`));
      for (const h of analysis.hallucinations) {
        console.log(chalk.red(`  [${h.severity}] ${h.claim}`));
        console.log(chalk.dim(`    Evidence: ${h.evidence}`));
      }
    }

    console.log(chalk.dim(`\nEstimated cost: $${analysis.totalCost.estimatedCostUsd.toFixed(4)}`));
  });

program
  .command("analyze")
  .description("Analyze recent traces for a role")
  .requiredOption("--role-arn <arn>", "IAM role ARN")
  .option("--last <n>", "Number of recent traces", "10")
  .option("--region <region>", "AWS region", "us-east-1")
  .action(async (opts) => {
    const store = new TraceStore(opts.region);
    const analyzer = new ReasoningAnalyzer();

    const traces = await store.getRecentTraces(opts.roleArn, parseInt(opts.last));
    if (traces.length === 0) {
      console.log(chalk.yellow("No traces found for this role."));
      return;
    }

    console.log(chalk.bold(`\nAnalysis of ${traces.length} recent traces for ${opts.roleArn}:`));
    console.log("─".repeat(60));

    let totalCoherence = 0;
    let totalTokens = 0;
    let totalLoops = 0;

    for (const traceMeta of traces) {
      const fullTrace = await store.getTrace(traceMeta.traceId);
      if (!fullTrace) continue;

      const analysis = analyzer.analyzeTrace(fullTrace);
      totalCoherence += analysis.coherenceScore;
      totalTokens += fullTrace.totalTokens;
      totalLoops += analysis.loopsDetected.length;

      const status = fullTrace.status === "complete" ? chalk.green("✓") : chalk.red("✗");
      console.log(`  ${status} ${fullTrace.traceId.slice(0, 8)} | ${fullTrace.totalTokens} tokens | coherence: ${analysis.coherenceScore.toFixed(2)} | ${fullTrace.totalLatencyMs}ms`);
    }

    console.log("─".repeat(60));
    console.log(`  Avg coherence: ${(totalCoherence / traces.length).toFixed(2)}`);
    console.log(`  Total tokens: ${totalTokens}`);
    console.log(`  Loops detected: ${totalLoops}`);
  });

program
  .command("diff")
  .description("Compare two traces")
  .argument("<traceA>", "First trace ID")
  .argument("<traceB>", "Second trace ID")
  .option("--region <region>", "AWS region", "us-east-1")
  .action(async (traceAId, traceBId, opts) => {
    const store = new TraceStore(opts.region);
    const analyzer = new ReasoningAnalyzer();
    const renderer = new TerminalRenderer();

    const traceA = await store.getTrace(traceAId);
    const traceB = await store.getTrace(traceBId);

    if (!traceA || !traceB) {
      console.error(chalk.red("✗ One or both traces not found"));
      process.exit(1);
    }

    const diff = analyzer.diffTraces(traceA, traceB);
    console.log(renderer.renderDiff(diff));
  });

program
  .command("alert")
  .description("Configure alerting rules")
  .option("--setup", "Interactive setup")
  .option("--list", "List current rules")
  .option("--region <region>", "AWS region", "us-east-1")
  .action(async (opts) => {
    const engine = new AlertEngine(opts.region);

    if (opts.list || !opts.setup) {
      console.log(chalk.bold("\nAlert Rules:"));
      console.log("─".repeat(60));
      for (const rule of engine.getRules()) {
        const status = rule.enabled ? chalk.green("ON") : chalk.red("OFF");
        console.log(`  ${status} ${rule.name.padEnd(25)} | condition: ${rule.condition} | threshold: ${rule.threshold} | action: ${rule.action}`);
      }
    }
  });

program.parse();
