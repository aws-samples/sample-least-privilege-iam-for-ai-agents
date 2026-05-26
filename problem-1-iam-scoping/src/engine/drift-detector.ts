import {
  IAMClient,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
  GetRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { DriftResult, DriftReport, IAMPolicy } from "../types.js";
import { ObservationStore } from "../collector/store.js";

export class DriftDetector {
  private iamClient: IAMClient;
  private store: ObservationStore;

  constructor(region: string, store: ObservationStore) {
    this.iamClient = new IAMClient({ region });
    this.store = store;
  }

  async detect(roleArn: string): Promise<DriftReport> {
    const roleName = roleArn.split("/").pop()!;
    const currentActions = await this.getCurrentPolicyActions(roleName);
    const observedActions = this.store.getUniqueActions(roleArn);

    const observedSet = new Set(observedActions.map((a) => `${a.service}:${a.action}`));
    const grantedSet = new Set(currentActions);

    const drifts: DriftResult[] = [];

    // Over-permissioned: granted but never observed
    for (const action of grantedSet) {
      if (!observedSet.has(action)) {
        drifts.push({
          category: "over-permissioned",
          severity: "medium",
          action,
          detail: `Action "${action}" is granted but was never observed in agent behavior`,
        });
      }
    }

    // Under-permissioned: observed but not granted
    for (const action of observedSet) {
      if (!grantedSet.has(action)) {
        drifts.push({
          category: "under-permissioned",
          severity: "high",
          action,
          detail: `Action "${action}" was observed but is not in the current policy (implicit deny)`,
        });
      }
    }

    // Check for stale observations (>30 days old with no recent activity)
    const observations = this.store.getObservationsForRole(roleArn);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentActions = new Set(
      observations.filter((o) => o.timestamp > thirtyDaysAgo).map((o) => `${o.service}:${o.action}`)
    );

    for (const action of grantedSet) {
      if (observedSet.has(action) && !recentActions.has(action)) {
        drifts.push({
          category: "stale",
          severity: "low",
          action,
          detail: `Action "${action}" has not been observed in the last 30 days`,
        });
      }
    }

    const report: DriftReport = {
      roleArn,
      analyzedAt: new Date().toISOString(),
      totalDrifts: drifts.length,
      highSeverity: drifts.filter((d) => d.severity === "high").length,
      mediumSeverity: drifts.filter((d) => d.severity === "medium").length,
      lowSeverity: drifts.filter((d) => d.severity === "low").length,
      drifts,
    };

    return report;
  }

  private async getCurrentPolicyActions(roleName: string): Promise<string[]> {
    const actions: string[] = [];

    // Get attached managed policies
    const attached = await this.iamClient.send(
      new ListAttachedRolePoliciesCommand({ RoleName: roleName })
    );

    for (const policy of attached.AttachedPolicies || []) {
      if (!policy.PolicyArn) continue;
      const policyDetail = await this.iamClient.send(
        new GetPolicyCommand({ PolicyArn: policy.PolicyArn })
      );
      const version = policyDetail.Policy?.DefaultVersionId;
      if (!version) continue;

      const versionDetail = await this.iamClient.send(
        new GetPolicyVersionCommand({ PolicyArn: policy.PolicyArn, VersionId: version })
      );

      const doc = JSON.parse(
        decodeURIComponent(versionDetail.PolicyVersion?.Document || "{}")
      ) as IAMPolicy;

      for (const stmt of doc.Statement || []) {
        if (stmt.Effect === "Allow") {
          actions.push(...(Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action]));
        }
      }
    }

    // Get inline policies
    const inline = await this.iamClient.send(
      new ListRolePoliciesCommand({ RoleName: roleName })
    );

    for (const policyName of inline.PolicyNames || []) {
      const inlinePolicy = await this.iamClient.send(
        new GetRolePolicyCommand({ RoleName: roleName, PolicyName: policyName })
      );
      const doc = JSON.parse(
        decodeURIComponent(inlinePolicy.PolicyDocument || "{}")
      ) as IAMPolicy;

      for (const stmt of doc.Statement || []) {
        if (stmt.Effect === "Allow") {
          actions.push(...(Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action]));
        }
      }
    }

    return this.expandWildcards(actions);
  }

  private expandWildcards(actions: string[]): string[] {
    // For now, return as-is. Full wildcard expansion requires the action DB.
    return actions;
  }
}
