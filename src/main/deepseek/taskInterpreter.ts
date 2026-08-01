import { z } from 'zod';
import type { ChatMessage, ProposedTask } from '../../shared/domain';
import { AppError } from '../../shared/errors';
import { taskListSchema } from '../../shared/schemas';

const responseSchema = z.object({ tasks: taskListSchema }).strict();

type TaskToolClient = {
  createTaskToolCall(messages: ChatMessage[], repairMessage?: string): Promise<string>;
};

export class TaskInterpreter {
  constructor(private readonly client: TaskToolClient) {}

  async interpret(messages: ChatMessage[]): Promise<ProposedTask[]> {
    let repairMessage: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.client.createTaskToolCall(messages, repairMessage);
        return responseSchema.parse(JSON.parse(raw)).tasks;
      } catch (error) {
        if (error instanceof AppError && error.code === 'DEEPSEEK_UNAVAILABLE') {
          throw error;
        }
        repairMessage =
          'Your previous replace_tasks arguments failed validation. Return the complete task list again and obey every schema field exactly.';
      }
    }
    throw new AppError(
      'DEEPSEEK_INVALID_RESPONSE',
      'DeepSeek returned an invalid task list twice.',
      true,
    );
  }
}
