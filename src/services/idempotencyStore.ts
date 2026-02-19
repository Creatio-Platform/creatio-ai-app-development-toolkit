import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export type IdempotencyRecord = {
  createdAt: number;
  response: Record<string, unknown>;
};

export class IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyRecord>();
  private readonly storagePath: string;

  constructor(
    private readonly ttlMs: number = 24 * 60 * 60 * 1000,
    storagePath: string = path.join(process.cwd(), 'data', 'idempotency-keys.json'),
  ) {
    this.storagePath = storagePath;
    this.loadFromDisk();
  }

  get(scope: string, key: string): Record<string, unknown> | undefined {
    this.cleanup();
    const entry = this.entries.get(this.getCompoundKey(scope, key));
    return entry?.response;
  }

  set(scope: string, key: string, response: Record<string, unknown>): void {
    this.cleanup();
    this.entries.set(this.getCompoundKey(scope, key), {
      createdAt: Date.now(),
      response,
    });
    this.saveToDisk();
  }

  private getCompoundKey(scope: string, key: string): string {
    return `${scope}:${key}`;
  }

  private cleanup(): void {
    const now = Date.now();
    let changed = false;
    for (const [key, value] of this.entries.entries()) {
      if (now - value.createdAt > this.ttlMs) {
        this.entries.delete(key);
        changed = true;
      }
    }

    if (changed) {
      this.saveToDisk();
    }
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.storagePath)) {
        return;
      }

      const raw = readFileSync(this.storagePath, 'utf-8');
      if (!raw.trim()) {
        return;
      }

      const parsed = JSON.parse(raw) as Record<string, IdempotencyRecord>;
      for (const [key, value] of Object.entries(parsed)) {
        this.entries.set(key, value);
      }
      this.cleanup();
    } catch {
      this.entries.clear();
    }
  }

  private saveToDisk(): void {
    const dir = path.dirname(this.storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const serialized: Record<string, IdempotencyRecord> = {};
    for (const [key, value] of this.entries.entries()) {
      serialized[key] = value;
    }

    writeFileSync(this.storagePath, JSON.stringify(serialized, null, 2), 'utf-8');
  }
}
