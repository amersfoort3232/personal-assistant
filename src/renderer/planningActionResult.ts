export type PlanningActionResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'not-started' };
