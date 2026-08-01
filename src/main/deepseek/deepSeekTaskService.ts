import type { ChatMessage, ProposedTask } from '../../shared/domain';
import { AppError } from '../../shared/errors';
import type { CredentialVault } from '../security/credentialVault';
import { DeepSeekClient } from './deepSeekClient';
import { TaskInterpreter } from './taskInterpreter';

export class DeepSeekTaskService {
  constructor(
    private readonly vault: Pick<CredentialVault, 'get'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async interpret(messages: ChatMessage[]): Promise<ProposedTask[]> {
    const apiKey = await this.vault.get('deepseek-api-key');
    if (!apiKey) {
      throw new AppError('VALIDATION_FAILED', 'A DeepSeek API key is required.', false);
    }
    return new TaskInterpreter(new DeepSeekClient(apiKey, this.fetchImpl)).interpret(messages);
  }
}
