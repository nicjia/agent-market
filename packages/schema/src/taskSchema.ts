import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const TaskSchemaZod = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).default({}),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  maxBounty: z.number().int().positive(),
  ttlSeconds: z.number().int().positive(),
  requester: z.string().min(1),
  riskTier: z.number().int().min(0).max(3).optional()
});

export type TaskSchema = z.infer<typeof TaskSchemaZod>;

export const TaskSchemaJson = zodToJsonSchema(TaskSchemaZod, "TaskSchema");

export const SubmittedPayloadZod = z.object({
  taskId: z.string().min(1),
  result: z.unknown(),
  evidence: z.record(z.string(), z.unknown()).default({}),
  provider: z.string().min(1)
});

export type SubmittedPayload = z.infer<typeof SubmittedPayloadZod>;

export const SubmittedPayloadJson = zodToJsonSchema(SubmittedPayloadZod, "SubmittedPayload");
