import Database from "better-sqlite3";
import { ObservedAction, CollectionRun } from "../types.js";
import { randomUUID } from "crypto";
import path from "path";
import { mkdirSync } from "fs";

const DB_DIR = path.join(process.env.HOME || "~", ".agentic-iam");
const DB_PATH = path.join(DB_DIR, "observations.db");

export class ObservationStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || DB_PATH;
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_arn TEXT NOT NULL,
        service TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_arn TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        request_params TEXT,
        run_id TEXT NOT NULL,
        UNIQUE(role_arn, service, action, resource_arn)
      );

      CREATE TABLE IF NOT EXISTS collection_runs (
        run_id TEXT PRIMARY KEY,
        role_arn TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        event_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_obs_role ON observations(role_arn);
      CREATE INDEX IF NOT EXISTS idx_obs_service ON observations(service);
    `);
  }

  startRun(roleArn: string, startTime: string): string {
    const runId = randomUUID();
    this.db.prepare(
      "INSERT INTO collection_runs (run_id, role_arn, start_time, end_time, event_count) VALUES (?, ?, ?, ?, 0)"
    ).run(runId, roleArn, startTime, startTime);
    return runId;
  }

  completeRun(runId: string, endTime: string, eventCount: number): void {
    this.db.prepare(
      "UPDATE collection_runs SET end_time = ?, event_count = ? WHERE run_id = ?"
    ).run(endTime, eventCount, runId);
  }

  insertObservation(action: ObservedAction, runId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO observations (role_arn, service, action, resource_arn, timestamp, request_params, run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      action.resourceArn.split(":")[4] ? `arn:aws:iam::${action.resourceArn.split(":")[4]}:role/*` : "",
      action.service,
      action.action,
      action.resourceArn,
      action.timestamp,
      action.requestParams ? JSON.stringify(action.requestParams) : null,
      runId
    );
  }

  insertObservationForRole(roleArn: string, action: ObservedAction, runId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO observations (role_arn, service, action, resource_arn, timestamp, request_params, run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      roleArn,
      action.service,
      action.action,
      action.resourceArn,
      action.timestamp,
      action.requestParams ? JSON.stringify(action.requestParams) : null,
      runId
    );
  }

  getObservationsForRole(roleArn: string): ObservedAction[] {
    const rows = this.db.prepare(
      "SELECT service, action, resource_arn, timestamp, request_params FROM observations WHERE role_arn = ?"
    ).all(roleArn) as Array<{ service: string; action: string; resource_arn: string; timestamp: string; request_params: string | null }>;

    return rows.map((row) => ({
      service: row.service,
      action: row.action,
      resourceArn: row.resource_arn,
      timestamp: row.timestamp,
      requestParams: row.request_params ? JSON.parse(row.request_params) : undefined,
    }));
  }

  getUniqueActions(roleArn: string): Array<{ service: string; action: string; resourceArn: string }> {
    return this.db.prepare(
      "SELECT DISTINCT service, action, resource_arn as resourceArn FROM observations WHERE role_arn = ?"
    ).all(roleArn) as Array<{ service: string; action: string; resourceArn: string }>;
  }

  getRuns(roleArn?: string): CollectionRun[] {
    const query = roleArn
      ? "SELECT * FROM collection_runs WHERE role_arn = ? ORDER BY start_time DESC"
      : "SELECT * FROM collection_runs ORDER BY start_time DESC";
    const rows = roleArn
      ? this.db.prepare(query).all(roleArn)
      : this.db.prepare(query).all();
    return rows as CollectionRun[];
  }

  close(): void {
    this.db.close();
  }
}
