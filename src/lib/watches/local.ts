import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Delivery, DocumentStore, DurableQueue, Message } from "./model";

// SQLite WAL + BEGIN IMMEDIATE serializes claims across independently running processes.
export class LocalStore implements DocumentStore, DurableQueue {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, body TEXT NOT NULL, enqueued_at INTEGER NOT NULL, available_at INTEGER NOT NULL, receipt TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0, dead_reason TEXT);
      CREATE INDEX IF NOT EXISTS queue_due ON deliveries(dead_reason, available_at, lease_until);`);
  }
  async get<T>(key: string): Promise<T | undefined> {
    const row = this.db.prepare("SELECT value FROM documents WHERE key=?").get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  async mutate<T, R>(key: string, change: (current: T | undefined) => { value: T; result: R }, expiresAt?: number): Promise<R> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT value FROM documents WHERE key=?").get(key) as { value: string } | undefined;
      const { value, result } = change(row ? JSON.parse(row.value) as T : undefined);
      this.db.prepare("INSERT INTO documents(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=COALESCE(excluded.expires_at, documents.expires_at)").run(key, JSON.stringify(value), expiresAt ?? null);
      this.db.exec("COMMIT"); return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async send(message: Message, availableAt = Date.now()) {
    this.db.prepare("INSERT INTO deliveries(id,body,enqueued_at,available_at) VALUES(?,?,?,?)").run(randomUUID(), JSON.stringify(message), Date.now(), availableAt);
  }
  async mutatePair<A, B, R>(keys: [string, string], change: (a: A | undefined, b: B | undefined) => { values: [A, B]; result: R }, expiresAt?: [number | undefined, number | undefined]): Promise<R> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = keys.map((key) => this.db.prepare("SELECT value FROM documents WHERE key=?").get(key) as { value: string } | undefined);
      const changed = change(rows[0] ? JSON.parse(rows[0].value) as A : undefined, rows[1] ? JSON.parse(rows[1].value) as B : undefined);
      changed.values.forEach((value, index) => this.db.prepare("INSERT INTO documents(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=COALESCE(excluded.expires_at, documents.expires_at)").run(keys[index], JSON.stringify(value), expiresAt?.[index] ?? null));
      this.db.exec("COMMIT"); return changed.result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async claim(leaseMs: number, now = Date.now()): Promise<Delivery | undefined> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT id,body,enqueued_at FROM deliveries WHERE dead_reason IS NULL AND available_at<=? AND COALESCE(lease_until,0)<=? ORDER BY available_at,enqueued_at,id LIMIT 1").get(now, now) as { id: string; body: string; enqueued_at: number } | undefined;
      if (!row) { this.db.exec("COMMIT"); return undefined; }
      const receipt = randomUUID();
      this.db.prepare("UPDATE deliveries SET receipt=?,lease_until=?,attempts=attempts+1 WHERE id=?").run(receipt, now + leaseMs, row.id);
      this.db.exec("COMMIT");
      return { id: row.id, receipt, message: JSON.parse(row.body) as Message, enqueuedAt: row.enqueued_at };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async acknowledge(delivery: Delivery) {
    this.db.prepare("DELETE FROM deliveries WHERE id=? AND receipt=? AND lease_until>?").run(delivery.id, delivery.receipt, Date.now());
  }
  async retry(delivery: Delivery, availableAt: number) {
    this.db.prepare("UPDATE deliveries SET available_at=?,lease_until=NULL,receipt=NULL WHERE id=? AND receipt=? AND lease_until>?").run(availableAt, delivery.id, delivery.receipt, Date.now());
  }
  async deadLetter(delivery: Delivery, reason: string) {
    this.db.prepare("UPDATE deliveries SET dead_reason=?,lease_until=NULL WHERE id=? AND receipt=? AND lease_until>?").run(reason, delivery.id, delivery.receipt, Date.now());
  }
  inspect() { return this.db.prepare("SELECT id,body,enqueued_at,available_at,lease_until,attempts,dead_reason FROM deliveries ORDER BY enqueued_at").all(); }
  cleanup(now = Date.now()) {
    this.db.prepare("DELETE FROM documents WHERE expires_at IS NOT NULL AND expires_at<?").run(now);
    this.db.prepare("DELETE FROM deliveries WHERE enqueued_at<?").run(now - 7 * 24 * 60 * 60_000);
  }
  close() { this.db.close(); }
}
