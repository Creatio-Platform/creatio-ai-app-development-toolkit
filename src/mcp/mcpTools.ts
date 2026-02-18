import { Tool } from '@langchain/core/tools';
import { getTranslationServer } from './translationServer.js';

/**
 * LangChain Tool wrapper for MCP detect_language
 */
export class MCPDetectLanguageTool extends Tool {
  name = 'detect_language';
  description =
    'Detects the language of input text. Use this to identify if text is in Ukrainian, English, Russian, or other languages. Returns the detected language name and confidence level.';

  async _call(input: string): Promise<string> {
    try {
      const server = getTranslationServer();
      const result = await server.detectLanguageDirect(input);
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : 'Detection failed',
      });
    }
  }
}

/**
 * LangChain Tool wrapper for MCP translate
 */
export class MCPTranslateTool extends Tool {
  name = 'translate_ukrainian_to_english';
  description =
    'Translates Ukrainian text to English. Only use this tool if you have confirmed the text is in Ukrainian language. Input should be Ukrainian text, returns English translation.';

  async _call(input: string): Promise<string> {
    try {
      const server = getTranslationServer();
      const translation = await server.translateDirect(input);
      return translation;
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : 'Translation failed',
      });
    }
  }
}

/**
 * Get all MCP tools for LangChain Agent
 */
export function getMCPTools(): Tool[] {
  return [new MCPDetectLanguageTool(), new MCPTranslateTool()];
}
