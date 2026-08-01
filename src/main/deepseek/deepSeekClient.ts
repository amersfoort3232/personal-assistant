import type { ChatMessage } from '../../shared/domain';
import { AppError } from '../../shared/errors';
import { replaceTasksTool, TASK_EXTRACTION_SYSTEM_PROMPT } from './prompt';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

export class DeepSeekClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createTaskToolCall(
    messages: ChatMessage[],
    repairMessage?: string,
  ): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          temperature: 0,
          max_tokens: 3000,
          messages: [
            { role: 'system', content: TASK_EXTRACTION_SYSTEM_PROMPT },
            ...messages.map(({ role, text }) => ({ role, content: text })),
            ...(repairMessage ? [{ role: 'user', content: repairMessage }] : []),
          ],
          tools: [replaceTasksTool],
          tool_choice: { type: 'function', function: { name: 'replace_tasks' } },
        }),
      });
    } catch {
      throw new AppError(
        'DEEPSEEK_UNAVAILABLE',
        'DeepSeek could not be reached.',
        true,
      );
    }

    if (!response.ok) {
      throw new AppError(
        'DEEPSEEK_UNAVAILABLE',
        `DeepSeek request failed with status ${response.status}.`,
        response.status === 429 || response.status >= 500,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw this.invalidResponse();
    }

    const argumentsText = this.replaceTasksArguments(payload);
    if (!argumentsText) {
      throw this.invalidResponse();
    }
    return argumentsText;
  }

  private replaceTasksArguments(payload: unknown): string | undefined {
    if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined;

    const choice = payload.choices[0];
    if (!isRecord(choice) || choice.finish_reason === 'length' || !isRecord(choice.message)) {
      return undefined;
    }

    const toolCalls = choice.message.tool_calls;
    if (!Array.isArray(toolCalls)) return undefined;

    for (const toolCall of toolCalls) {
      if (!isRecord(toolCall) || !isRecord(toolCall.function)) continue;
      if (toolCall.function.name !== 'replace_tasks') continue;

      const argumentsText = toolCall.function.arguments;
      if (typeof argumentsText === 'string' && argumentsText.length > 0) {
        return argumentsText;
      }
    }
    return undefined;
  }

  private invalidResponse(): AppError {
    return new AppError(
      'DEEPSEEK_INVALID_RESPONSE',
      'DeepSeek did not return a complete task list.',
      true,
    );
  }
}
