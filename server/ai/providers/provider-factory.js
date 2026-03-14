import { OpenAIProvider } from "./openai-provider.js";
import { LocalOperationalProvider } from "./local-operational-provider.js";

export function createProviderFactory(config) {
  const openAiProvider = new OpenAIProvider(config);
  const localProvider = new LocalOperationalProvider();

  return {
    resolvePrimaryProvider() {
      return openAiProvider.isConfigured() ? openAiProvider : localProvider;
    },
    resolveFallbackProvider() {
      return localProvider;
    },
  };
}

