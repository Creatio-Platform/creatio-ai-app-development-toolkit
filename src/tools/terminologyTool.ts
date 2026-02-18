import { tool } from 'langchain';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

const TERMINOLOGY_FILE = path.join(process.cwd(), 'data', 'terminology.json');

/**
 * Interface for terminology entries
 */
interface TerminologyEntry {
  ukrainian: string;
  english: string;
  context?: string;
  style?: 'technical' | 'conversational' | 'formal';
  timestamp: string;
}

/**
 * Load terminology database from file
 */
async function loadTerminologyDB(): Promise<TerminologyEntry[]> {
  try {
    const data = await fs.readFile(TERMINOLOGY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist yet, return empty array
    return [];
  }
}

/**
 * Save terminology database to file
 */
async function saveTerminologyDB(entries: TerminologyEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(TERMINOLOGY_FILE), { recursive: true });
  await fs.writeFile(TERMINOLOGY_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Tool to save terminology pairs
 */
export const saveTerminologyTool = tool(
  async ({
    ukrainian,
    english,
    context,
    style,
  }: {
    ukrainian: string;
    english: string;
    context?: string;
    style?: 'technical' | 'conversational' | 'formal';
  }) => {
    const db = await loadTerminologyDB();

    const entry: TerminologyEntry = {
      ukrainian: ukrainian.toLowerCase().trim(),
      english: english.toLowerCase().trim(),
      context,
      style,
      timestamp: new Date().toISOString(),
    };

    // Check if term already exists, update if found
    const existingIndex = db.findIndex((e) => e.ukrainian === entry.ukrainian);
    if (existingIndex >= 0) {
      db[existingIndex] = entry;
    } else {
      db.push(entry);
    }

    await saveTerminologyDB(db);

    return JSON.stringify({
      success: true,
      message: `Terminology saved: "${ukrainian}" → "${english}"`,
      total_terms: db.length,
    });
  },
  {
    name: 'save_terminology',
    description:
      'Save a Ukrainian-English term pair to the terminology database for future reference. Use this when you want to remember how to translate specific terms consistently. Provide the Ukrainian term, English translation, optional context (e.g., "machine learning", "medical"), and optional style (technical, conversational, formal).',
    schema: z.object({
      ukrainian: z.string().describe('Ukrainian term or phrase'),
      english: z.string().describe('English translation'),
      context: z
        .string()
        .optional()
        .describe('Context or domain (e.g., ML, medical, legal)'),
      style: z
        .enum(['technical', 'conversational', 'formal'])
        .optional()
        .describe('Translation style'),
    }),
  }
);

/**
 * Tool to load relevant terminology
 */
export const loadTerminologyTool = tool(
  async ({ query }: { query: string }) => {
    const db = await loadTerminologyDB();

    if (db.length === 0) {
      return JSON.stringify({
        found: false,
        message: 'No terminology entries found in database',
        relevant_terms: [],
      });
    }

    // Simple search: find terms where Ukrainian term appears in query
    const queryLower = query.toLowerCase();
    const relevantTerms = db.filter((entry) =>
      queryLower.includes(entry.ukrainian)
    );

    if (relevantTerms.length === 0) {
      return JSON.stringify({
        found: false,
        message: `No relevant terminology found for query: "${query}"`,
        database_size: db.length,
        relevant_terms: [],
      });
    }

    return JSON.stringify({
      found: true,
      message: `Found ${relevantTerms.length} relevant term(s)`,
      relevant_terms: relevantTerms.map((t) => ({
        ukrainian: t.ukrainian,
        english: t.english,
        context: t.context,
        style: t.style,
      })),
    });
  },
  {
    name: 'load_terminology',
    description:
      'Search the terminology database for relevant Ukrainian-English term pairs based on a query. Use this BEFORE translating to check if there are established translations for terms in your input text. Returns matching terms with their translations, context, and style preferences.',
    schema: z.object({
      query: z
        .string()
        .describe('Text to search for (typically the input text to translate)'),
    }),
  }
);
