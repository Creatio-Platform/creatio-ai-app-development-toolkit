import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { config } from '../config/env.js';

/**
 * MCP Server for Ukrainian to English translation
 * Provides mcp_translate tool via Model Context Protocol
 */
export class TranslationMCPServer {
  private server: Server;
  private model: ChatOpenAI | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'translation-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize OpenAI model if API key is available
    if (config.openaiApiKey) {
      this.model = new ChatOpenAI({
        modelName: 'gpt-4o-mini',
        temperature: 0.3,
        openAIApiKey: config.openaiApiKey,
      });
    }

    this.setupHandlers();
  }

  private setupHandlers() {
    // Handle list_tools request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'mcp_detect_language',
          description:
            'Detects the language of input text. Returns the detected language name (e.g., Ukrainian, English, Russian, Polish, etc.) with confidence level.',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Text to detect the language of',
              },
            },
            required: ['text'],
          },
        },
        {
          name: 'mcp_translate',
          description:
            'Translates Ukrainian text to English using OpenAI GPT-4o-mini model. Accepts Ukrainian words, phrases, or sentences and returns accurate English translations.',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Ukrainian text to translate to English',
              },
            },
            required: ['text'],
          },
        },
      ],
    }));

    // Handle call_tool request
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { text } = request.params.arguments as { text: string };

      if (!text || typeof text !== 'string') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Invalid input. Expected a string field named "text".',
              }),
            },
          ],
        };
      }

      try {
        if (request.params.name === 'mcp_detect_language') {
          const result = await this.detectLanguage(text);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        } else if (request.params.name === 'mcp_translate') {
          const translation = await this.translate(text);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  translation,
                  source_language: 'Ukrainian',
                  target_language: 'English',
                }),
              },
            ],
          };
        } else {
          throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  error instanceof Error
                    ? error.message
                    : 'Tool execution failed',
              }),
            },
          ],
        };
      }
    });
  }

  private async detectLanguage(
    text: string
  ): Promise<{ language: string; confidence: string }> {
    if (!this.model) {
      throw new Error(
        'OPENAI_API_KEY is not configured. Language detection requires a valid OpenAI API key.'
      );
    }

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You are a language detection expert. Identify the language of the input text. Respond with ONLY a JSON object in this exact format: {{"language": "LanguageName", "confidence": "high/medium/low"}}. Language names should be in English (e.g., Ukrainian, English, Russian, Polish, German, French, etc.).',
      ],
      ['user', '{text}'],
    ]);

    const chain = prompt.pipe(this.model).pipe(new StringOutputParser());
    const result = await chain.invoke({ text });

    try {
      // Parse the JSON response
      const parsed = JSON.parse(result);
      return {
        language: parsed.language || 'Unknown',
        confidence: parsed.confidence || 'low',
      };
    } catch {
      // Fallback if parsing fails
      return {
        language: result.trim(),
        confidence: 'medium',
      };
    }
  }

  private async translate(text: string): Promise<string> {
    if (!this.model) {
      throw new Error(
        'OPENAI_API_KEY is not configured. Translation requires a valid OpenAI API key.'
      );
    }

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You are a professional translator. Translate the following Ukrainian text to English. Provide only the English translation without any explanations or additional text.',
      ],
      ['user', '{input}'],
    ]);

    const chain = prompt.pipe(this.model).pipe(new StringOutputParser());
    const result = await chain.invoke({ input: text });

    return result;
  }

  /**
   * Get the MCP Server instance
   */
  getServer(): Server {
    return this.server;
  }

  /**
   * Start the server with stdio transport (for CLI usage)
   */
  async runStdio() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Call the translate tool programmatically (for in-process usage)
   */
  async translateDirect(text: string): Promise<string> {
    return this.translate(text);
  }

  /**
   * Call the detect language tool programmatically (for in-process usage)
   */
  async detectLanguageDirect(
    text: string
  ): Promise<{ language: string; confidence: string }> {
    return this.detectLanguage(text);
  }
}

// Singleton instance for in-process usage
let serverInstance: TranslationMCPServer | null = null;

export function getTranslationServer(): TranslationMCPServer {
  if (!serverInstance) {
    serverInstance = new TranslationMCPServer();
  }
  return serverInstance;
}
