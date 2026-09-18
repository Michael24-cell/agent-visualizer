import { z } from 'zod';

export const ServiceHealthSchema = z.object({
  service: z.literal('ready'),
  database: z.literal('ready'),
  checkedAt: z.iso.datetime(),
});

export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;

export const FoundationRecordSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type FoundationRecord = z.infer<typeof FoundationRecordSchema>;

export const FoundationStatusSchema = z.object({
  record: FoundationRecordSchema,
  migrationCount: z.number().int().nonnegative(),
});

export type FoundationStatus = z.infer<typeof FoundationStatusSchema>;
