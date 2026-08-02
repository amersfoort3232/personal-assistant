import { z } from 'zod';

export const rendererErrorReportSchema = z.object({
  kind: z.enum(['unhandled-error', 'unhandled-rejection']),
  name: z.string().min(1).max(100),
  message: z.string().min(1).max(1_000),
  stack: z.string().max(8_000).optional(),
}).strict();

export type RendererErrorReport = z.infer<typeof rendererErrorReportSchema>;

function bounded(value: string, limit: number, preserveLines = false): string {
  const controls = preserveLines
    ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;
  return value.replace(controls, ' ').trim().slice(0, limit);
}

export function toRendererErrorReport(
  kind: RendererErrorReport['kind'],
  reason: unknown,
): RendererErrorReport {
  if (!(reason instanceof Error)) {
    return { kind, name: 'UnknownError', message: 'Unknown non-Error failure.' };
  }
  return {
    kind,
    name: bounded(reason.name || 'Error', 100),
    message: bounded(reason.message || reason.name || 'Renderer failure.', 1_000),
    ...(reason.stack ? { stack: bounded(reason.stack, 8_000, true) } : {}),
  };
}
