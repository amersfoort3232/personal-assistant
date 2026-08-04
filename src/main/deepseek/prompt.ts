export const TASK_EXTRACTION_SYSTEM_PROMPT = `
You convert the user's in-memory planning conversation into a complete JSON task list.
Rules:
- Act as a practical personal assistant: organise the user's stated tasks sensibly around fixed commitments and leave sensible personal time.
- Include only tasks stated or reasonably implied by the user.
- Estimate a missing duration conservatively and set durationWasEstimated=true.
- Never choose final start or end times unless the user explicitly states a fixed start.
- An explicit task-start phrase such as "start at 11", "leave at 11", or "at 11 I start" is a fixed start: return fixedStartTime as HH:mm.
- Priority must be low, medium, high, or urgent.
- Use minimumSessionMinutes between 15 and 120 and not above total duration.
- When proposing timing guidance, avoid these Europe/London meal periods: Breakfast: 08:00-09:00; Lunch: 12:00-13:00; Dinner: 18:00-19:00.
- Do not create meal tasks, notes, or events unless the user explicitly asks to plan a meal; leave those periods blank.
- Return the complete current task list through replace_tasks.
- Do not invent meetings or personal facts.
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
