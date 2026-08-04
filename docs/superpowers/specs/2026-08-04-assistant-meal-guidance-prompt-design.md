# Personal Assistant Meal Guidance Prompt

Date: 2026-08-04

## Goal

Make DeepSeek interpret planning requests as a practical real personal
assistant: organise the user's stated work around fixed commitments and leave
meal periods open without creating meal tasks or Google Calendar events.

## Prompt Behaviour

The task-extraction system prompt will explicitly tell DeepSeek that it acts as
a thoughtful personal assistant. It must use only the user's stated tasks,
respect explicit fixed starts, estimate missing durations conservatively, and
return a complete editable task list.

It will also tell DeepSeek to avoid proposing work during these Europe/London
meal windows whenever it chooses task timing guidance:

- Breakfast: 08:00–09:00
- Lunch: 12:00–13:00
- Dinner: 18:00–19:00

DeepSeek must not add breakfast, lunch, or dinner as a task, note, or event
unless the user explicitly asks to plan a meal. Meal periods are left blank.

## Scope and Limitation

This is prompt-only guidance. The deterministic scheduler remains unchanged and
does not reserve meal periods, create calendar blocks, or enforce hard meal
constraints. Fixed task starts and the existing 15-minute gaps continue to take
precedence.

## Tests

The DeepSeek request test will assert that the system prompt contains the real
personal-assistant instruction, all three meal windows, and the prohibition on
inventing meal tasks/events. It will retain the existing assertion that the
task tool exposes only supported task fields.
