import { randomUUID } from 'crypto';
import type { SchemaLocale } from './creatioSchemaService.js';

export type PendingTemplateSelection = {
  schemaName: string;
  schemaType: string;
  userLevelSchema: boolean;
  language: SchemaLocale;
  createdAt: number;
};

export class TemplateSelectionStore {
  private readonly entries = new Map<string, PendingTemplateSelection>();

  constructor(private readonly ttlMs: number = 10 * 60 * 1000) {}

  create(input: Omit<PendingTemplateSelection, 'createdAt'>): string {
    this.cleanup();
    const selectionId = randomUUID();
    this.entries.set(selectionId, {
      ...input,
      createdAt: Date.now(),
    });
    return selectionId;
  }

  get(selectionId: string): PendingTemplateSelection | undefined {
    this.cleanup();
    return this.entries.get(selectionId);
  }

  delete(selectionId: string): void {
    this.entries.delete(selectionId);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.entries.entries()) {
      if (now - value.createdAt > this.ttlMs) {
        this.entries.delete(key);
      }
    }
  }
}

