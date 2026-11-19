import type { RuntimeConfig } from '@harness/config';
import { completeTextClaude } from '@harness/runtime-claude';
import { completeText } from '@harness/runtime-openai';
import { CHATGPT_RESOURCE, type ChatGptAuth } from './chatgpt-auth.js';
import type { ModelPlanner } from './model-planner.js';

// The Planner for a connected account, or undefined for practice agents.
// Shared by the service and the planner eval so both ask the same way.
export function plannerFor(
  runtime: RuntimeConfig,
  chatgpt: Pick<ChatGptAuth, 'accessToken'>,
): ModelPlanner | undefined {
  switch (runtime.kind) {
    case 'chatgpt':
      return {
        label: runtime.model,
        complete: (system, user, signal) =>
          completeText(
            {
              baseUrl: CHATGPT_RESOURCE,
              model: runtime.model,
              transport: 'responses',
              accessToken: () => chatgpt.accessToken(),
            },
            system,
            user,
            signal,
          ),
      };
    case 'claude':
      // Planning is a short, structured answer: the balanced model.
      return {
        label: 'Claude Sonnet',
        complete: (system, user, signal) =>
          completeTextClaude('sonnet', system, user, signal),
      };
    case 'openai':
      return {
        label: runtime.model,
        complete: (system, user, signal) =>
          completeText(
            {
              baseUrl: runtime.baseUrl,
              apiKey: runtime.apiKey,
              model: runtime.model,
              maxOutputTokens: 2_048,
            },
            system,
            user,
            signal,
          ),
      };
    default:
      return undefined;
  }
}
