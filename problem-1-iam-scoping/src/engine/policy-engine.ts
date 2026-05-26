import { IAMPolicy, PolicyStatement } from "../types.js";
import { ObservationStore } from "../collector/store.js";

export class PolicyEngine {
  private store: ObservationStore;

  constructor(store: ObservationStore) {
    this.store = store;
  }

  generate(roleArn: string): IAMPolicy {
    const actions = this.store.getUniqueActions(roleArn);

    if (actions.length === 0) {
      throw new Error(`No observations found for role: ${roleArn}. Run 'observe' first.`);
    }

    // Group actions by service
    const serviceGroups = new Map<string, Array<{ action: string; resourceArn: string }>>();
    for (const entry of actions) {
      const group = serviceGroups.get(entry.service) || [];
      group.push({ action: entry.action, resourceArn: entry.resourceArn });
      serviceGroups.set(entry.service, group);
    }

    // Build policy statements
    const statements: PolicyStatement[] = [];
    for (const [service, entries] of serviceGroups) {
      const actionSet = [...new Set(entries.map((e) => `${service}:${e.action}`))];
      const resources = this.scopeResources([...new Set(entries.map((e) => e.resourceArn))]);

      statements.push({
        Sid: this.generateSid(service),
        Effect: "Allow",
        Action: actionSet.sort(),
        Resource: resources,
      });
    }

    return {
      Version: "2012-10-17",
      Statement: statements,
    };
  }

  private scopeResources(arns: string[]): string[] {
    if (arns.length === 0) return ["*"];

    // If all ARNs share a common prefix, use wildcard
    const filtered = arns.filter((a) => a !== "*" && !a.endsWith(":*"));
    if (filtered.length === 0) return arns;

    // Check for common prefix within same service/region/account
    const prefixGroups = new Map<string, string[]>();
    for (const arn of filtered) {
      const parts = arn.split(":");
      const prefix = parts.slice(0, 5).join(":");
      const group = prefixGroups.get(prefix) || [];
      group.push(arn);
      prefixGroups.set(prefix, group);
    }

    const result: string[] = [];
    for (const [, groupArns] of prefixGroups) {
      if (groupArns.length > 5) {
        // Too many specific resources — use wildcard for the common prefix
        const common = this.findCommonPrefix(groupArns);
        result.push(common + "*");
      } else {
        result.push(...groupArns);
      }
    }

    return result.length > 0 ? result : ["*"];
  }

  private findCommonPrefix(strings: string[]): string {
    if (strings.length === 0) return "";
    let prefix = strings[0];
    for (const s of strings.slice(1)) {
      while (!s.startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
      }
    }
    return prefix;
  }

  private generateSid(service: string): string {
    const name = service
      .split(".")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("");
    return `${name}Access`;
  }

  validatePolicy(policy: IAMPolicy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const json = JSON.stringify(policy);

    // Check size limits
    if (json.length > 10240) {
      errors.push(`Policy size (${json.length}) exceeds managed policy limit (10,240 chars)`);
    }

    // Check statement count
    if (policy.Statement.length > 20) {
      errors.push(`Statement count (${policy.Statement.length}) may exceed some limits`);
    }

    // Validate each statement
    for (const stmt of policy.Statement) {
      if (!stmt.Action || stmt.Action.length === 0) {
        errors.push(`Statement ${stmt.Sid}: missing actions`);
      }
      if (!stmt.Resource || stmt.Resource.length === 0) {
        errors.push(`Statement ${stmt.Sid}: missing resources`);
      }
      for (const action of stmt.Action) {
        if (!action.includes(":")) {
          errors.push(`Statement ${stmt.Sid}: invalid action format "${action}"`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
