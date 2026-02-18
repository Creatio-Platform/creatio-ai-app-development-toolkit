import { RunnableLambda } from '@langchain/core/runnables';

/**
 * A minimal LangChain chain that greets the input.
 * Uses a simple RunnableLambda as a fallback (no API keys needed).
 */
export const createHelloChain = () => {
  // Simple chain that doesn't require API keys
  const helloChain = RunnableLambda.from((input: string) => {
    return `Hello, ${input}!`;
  });

  return helloChain;
};
