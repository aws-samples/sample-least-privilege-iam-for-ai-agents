#!/usr/bin/env node
import { Command } from "commander";
import { ObservationStore } from "../collector/store.js";
import { LogCollector } from "../collector/collector.js";
import { PolicyEngine } from "../engine/policy-engine.js";
import { DriftDetector } from "../engine/drift-detector.js";
import chalk from "chalk";

const program = new Command();

program
  .name("agentic-iam")
  .description("Agentic IAM Policy Generator + Drift Detector")
  .version("1.0.0");

program
  .command("observe")
  .description("Collect CloudTrail events for an agent role")
  .requiredOption("--role-arn <arn>", "IAM role ARN to observe")
  .option("--days <number>", "Number of days to look back", "7")
  .option("--region <region>", "AWS region", "us-east-1")
  .action(async (opts) => {
    const store = new ObservationStore();
    const collector = new LogCollector(opts.region, store);

    console.log(chalk.blue(`Observing role: ${opts.roleArn}`));
    console.log(chalk.blue(`Looking back: ${opts.days} days`));

    try {
      const { eventCount, runId } = await collector.collect({
        roleArn: opts.roleArn,
        days: parseInt(opts.days),
        region: opts.region,
      });
      console.log(chalk.green(`✓ Collected ${eventCount} events (run: ${runId})`));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`✗ Error: ${message}`));
      process.exit(1);
    } finally {
      store.close();
    }
  });

program
  .command("generate")
  .description("Generate least-privilege policy from observations")
  .requiredOption("--role-arn <arn>", "IAM role ARN")
  .option("--format <format>", "Output format: json|yaml", "json")
  .option("--output <file>", "Output file path")
  .action(async (opts) => {
    const store = new ObservationStore();
    const engine = new PolicyEngine(store);

    try {
      const policy = engine.generate(opts.roleArn);
      const validation = engine.validatePolicy(policy);

      if (!validation.valid) {
        console.warn(chalk.yellow("⚠ Policy validation warnings:"));
        validation.errors.forEach((e) => console.warn(chalk.yellow(`  - ${e}`)));
      }

      const output = JSON.stringify(policy, null, 2);

      if (opts.output) {
        const { writeFileSync } = await import("fs");
        writeFileSync(opts.output, output);
        console.log(chalk.green(`✓ Policy written to ${opts.output}`));
      } else {
        console.log(output);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`✗ Error: ${message}`));
      process.exit(1);
    } finally {
      store.close();
    }
  });

program
  .command("drift")
  .description("Detect policy drift for an agent role")
  .requiredOption("--role-arn <arn>", "IAM role ARN")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--threshold <level>", "Minimum severity to report: high|medium|low", "low")
  .action(async (opts) => {
    const store = new ObservationStore();
    const detector = new DriftDetector(opts.region, store);

    try {
      const report = await detector.detect(opts.roleArn);

      console.log(chalk.bold(`\nDrift Report for: ${report.roleArn}`));
      console.log(`Analyzed at: ${report.analyzedAt}`);
      console.log(`Total drifts: ${report.totalDrifts}`);
      console.log(chalk.red(`  High: ${report.highSeverity}`));
      console.log(chalk.yellow(`  Medium: ${report.mediumSeverity}`));
      console.log(chalk.blue(`  Low: ${report.lowSeverity}`));

      const severityOrder = { high: 3, medium: 2, low: 1 };
      const threshold = severityOrder[opts.threshold as keyof typeof severityOrder] || 1;

      const filtered = report.drifts.filter(
        (d) => severityOrder[d.severity] >= threshold
      );

      if (filtered.length > 0) {
        console.log(chalk.bold("\nDetails:"));
        for (const drift of filtered) {
          const color = drift.severity === "high" ? chalk.red : drift.severity === "medium" ? chalk.yellow : chalk.blue;
          console.log(color(`  [${drift.severity.toUpperCase()}] ${drift.category}: ${drift.action}`));
          console.log(`    ${drift.detail}`);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`✗ Error: ${message}`));
      process.exit(1);
    } finally {
      store.close();
    }
  });

program
  .command("update")
  .description("Update IAM action database")
  .option("--source <source>", "Update source: botocore|docs", "botocore")
  .action(async (opts) => {
    console.log(chalk.blue(`Updating action database from: ${opts.source}`));
    // Delegates to shared self-update module
    const { SelfUpdater } = await import("../../shared/self-update/index.js");
    const updater = new SelfUpdater();
    const result = await updater.update(opts.source);
    console.log(chalk.green(`✓ Updated: ${result.newActions} new actions, ${result.deprecated} deprecated`));
  });

program
  .command("report")
  .description("Generate human-readable summary")
  .requiredOption("--role-arn <arn>", "IAM role ARN")
  .option("--format <format>", "Output format: markdown|text", "text")
  .action(async (opts) => {
    const store = new ObservationStore();
    const engine = new PolicyEngine(store);

    try {
      const actions = store.getUniqueActions(opts.roleArn);
      const runs = store.getRuns(opts.roleArn);

      console.log(chalk.bold(`\n═══ Agent IAM Report ═══`));
      console.log(`Role: ${opts.roleArn}`);
      console.log(`Collection runs: ${runs.length}`);
      console.log(`Unique actions observed: ${actions.length}`);
      console.log(`\nServices used:`);

      const services = new Map<string, number>();
      for (const a of actions) {
        services.set(a.service, (services.get(a.service) || 0) + 1);
      }
      for (const [svc, count] of [...services.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${svc}: ${count} actions`);
      }

      const policy = engine.generate(opts.roleArn);
      console.log(`\nGenerated policy: ${policy.Statement.length} statements`);
      console.log(`Policy size: ${JSON.stringify(policy).length} chars`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`✗ Error: ${message}`));
      process.exit(1);
    } finally {
      store.close();
    }
  });

program.parse();
