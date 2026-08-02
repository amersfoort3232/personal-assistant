export const TASK_EXTRACTION_SYSTEM_PROMPT = `
You convert the user's in-memory planning conversation into a complete JSON task list.
Rules:
- Include only tasks stated or reasonably implied by the user.
- Estimate a missing duration conservatively and set durationWasEstimated=true.
- Never choose final start or end times unless the user explicitly states a fixed start.
- An explicit task-start phrase such as "start at 11", "leave at 11", or "at 11 I start" is a fixed start: return fixedStartTime as HH:mm and do not turn it into a deadline.
- A phrase such as "finish before 11" or "due at 11" is a deadline, not a fixed start.
- Use Europe/London and RFC 3339 with an explicit offset for deadlines.
- Priority must be low, medium, high, or urgent.
- Use minimumSessionMinutes between 15 and 120 and not above total duration.
- Return the complete current task list through replace_tasks.
- Do not invent meetings, deadlines, or personal facts.
`.trim();

export const replaceTasksTool = {
  type: 'function',
  function: {
    name: 'replace_tasks',
    description: 'Replace the current complete task list with validated planning tasks.',
    strict: false,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          maxItems: 30,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id', 'title', 'durationMinutes', 'durationWasEstimated',
              'priority', 'canSplit', 'minimumSessionMinutes',
            ],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              notes: { type: 'string' },
              durationMinutes: { type: 'integer', minimum: 5, maximum: 480 },
              durationWasEstimated: { type: 'boolean' },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
              deadline: { type: 'string' },
              fixedStartTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
              canSplit: { type: 'boolean' },
              minimumSessionMinutes: { type: 'integer', minimum: 15, maximum: 120 },
            },
          },
        },
      },
    },
  },
} as const;
