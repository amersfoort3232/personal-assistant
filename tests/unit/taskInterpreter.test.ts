import { describe, expect, it, vi } from 'vitest';
import { DeepSeekClient } from '../../src/main/deepseek/deepSeekClient';
import { DeepSeekTaskService } from '../../src/main/deepseek/deepSeekTaskService';
import { TaskInterpreter } from '../../src/main/deepseek/taskInterpreter';

const messages = [{
  id: 'm1',
  role: 'user' as const,
  text: 'Study React for two hours',
  createdAt: '2026-08-01T09:00:00+01:00',
}];

const validArguments = JSON.stringify({
  tasks: [{
    id: 'task-1',
    title: 'Study React',
    durationMinutes: 120,
    durationWasEstimated: false,
    priority: 'medium',
    canSplit: true,
    minimumSessionMinutes: 30,
  }],
});

const deepSeekResponse = (argumentsText = validArguments, finishReason = 'tool_calls') => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({
    choices: [{
      finish_reason: finishReason,
      message: { tool_calls: [{ function: { name: 'replace_tasks', arguments: argumentsText } }] },
    }],
  }),
});

describe('TaskInterpreter', () => {
  it('accepts validated replace_tasks arguments', async () => {
    const client = {
      createTaskToolCall: vi.fn().mockResolvedValue(validArguments),
    };
    const interpreter = new TaskInterpreter(client);

    await expect(interpreter.interpret(messages)).resolves.toHaveLength(1);
  });

  it('repairs malformed JSON once before accepting a valid response', async () => {
    const client = {
      createTaskToolCall: vi.fn()
        .mockResolvedValueOnce('{not-json')
        .mockResolvedValueOnce(validArguments),
    };
    const interpreter = new TaskInterpreter(client);

    await expect(interpreter.interpret(messages)).resolves.toHaveLength(1);
    expect(client.createTaskToolCall).toHaveBeenCalledTimes(2);
    expect(client.createTaskToolCall).toHaveBeenLastCalledWith(messages, expect.any(String));
  });

  it('repairs one invalid response and rejects a second invalid response', async () => {
    const client = {
      createTaskToolCall: vi.fn()
        .mockResolvedValueOnce('{"tasks":[{"title":"Broken"}]}')
        .mockResolvedValueOnce('{"tasks":[{"title":"Still broken"}]}'),
    };
    const interpreter = new TaskInterpreter(client);

    await expect(interpreter.interpret(messages)).rejects.toMatchObject({
      code: 'DEEPSEEK_INVALID_RESPONSE',
      retryable: true,
    });
    expect(client.createTaskToolCall).toHaveBeenCalledTimes(2);
  });

  it('repairs unknown fields once before rejecting the response', async () => {
    const client = {
      createTaskToolCall: vi.fn().mockResolvedValue(JSON.stringify({
        tasks: [{
          id: 'task-1',
          title: 'Study React',
          durationMinutes: 120,
          durationWasEstimated: false,
          priority: 'medium',
          canSplit: true,
          minimumSessionMinutes: 30,
          scheduledStart: '2026-08-01T09:00:00+01:00',
        }],
      })),
    };

    await expect(new TaskInterpreter(client).interpret(messages)).rejects.toMatchObject({
      code: 'DEEPSEEK_INVALID_RESPONSE',
    });
    expect(client.createTaskToolCall).toHaveBeenCalledTimes(2);
  });
});

describe('DeepSeekClient', () => {
  it.each([
    ['missing', { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [] } }] }],
    ['wrong', { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'other', arguments: validArguments } }] } }] }],
  ])('rejects a %s tool call without exposing the response', async (_kind, payload) => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue(payload) });

    await expect(new DeepSeekClient('test-key', fetchImpl).createTaskToolCall(messages)).rejects.toMatchObject({
      code: 'DEEPSEEK_INVALID_RESPONSE',
      retryable: true,
    });
  });

  it('rejects a truncated response as invalid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(deepSeekResponse(validArguments, 'length'));

    await expect(new DeepSeekClient('test-key', fetchImpl).createTaskToolCall(messages)).rejects.toMatchObject({
      code: 'DEEPSEEK_INVALID_RESPONSE',
      retryable: true,
    });
  });

  it('normalizes malformed API payloads to a retryable invalid-response error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockRejectedValue(new SyntaxError('bad json')) });

    await expect(new DeepSeekClient('test-key', fetchImpl).createTaskToolCall(messages)).rejects.toMatchObject({
      code: 'DEEPSEEK_INVALID_RESPONSE',
      retryable: true,
    });
  });

  it('normalizes network errors to a retryable unavailable error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('socket failure'));

    await expect(new DeepSeekClient('test-key', fetchImpl).createTaskToolCall(messages)).rejects.toMatchObject({
      code: 'DEEPSEEK_UNAVAILABLE',
      retryable: true,
    });
  });

  it('maps HTTP availability and retryability without including a response body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, json: vi.fn() });

    await expect(new DeepSeekClient('test-key', fetchImpl).createTaskToolCall(messages)).rejects.toMatchObject({
      code: 'DEEPSEEK_UNAVAILABLE',
      retryable: true,
    });
  });
});

describe('DeepSeekTaskService', () => {
  it('looks up the API key when interpreting so a saved key works without restart', async () => {
    let savedKey: string | undefined;
    const vault = { get: vi.fn().mockImplementation(async () => savedKey) };
    const fetchImpl = vi.fn().mockResolvedValue(deepSeekResponse());
    const service = new DeepSeekTaskService(vault, fetchImpl);

    savedKey = 'key-saved-after-service-construction';

    await expect(service.interpret(messages)).resolves.toHaveLength(1);
    expect(vault.get).toHaveBeenCalledWith('deepseek-api-key');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${savedKey}` }),
      }),
    );
  });
});
