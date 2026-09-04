import { z } from "zod";

export const uuidSchema = z.uuid();
export const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Nur Kleinbuchstaben, Zahlen, _ und - sind erlaubt.");

export const httpUrlSchema = z
  .url()
  .refine((url) => url.startsWith("https://") || url.startsWith("http://"), "Nur HTTP(S)-Links sind erlaubt.");

export const linkSchema = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().min(1).max(80),
  url: httpUrlSchema,
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const linkInputSchema = linkSchema.omit({ id: true }).extend({ episodeId: z.uuid() });

export const episodeInputSchema = z.object({
  seriesId: z.uuid(),
  episodeKey: keySchema,
  numberLabel: z.string().trim().max(60).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).nullable().optional(),
  title: z.string().trim().min(1).max(300),
  releaseDate: z.iso.date().nullable().optional(),
  durationMinutes: z.number().int().positive().max(10_000).nullable().optional(),
  priorityOnRelease: z.boolean().default(false),
  archived: z.boolean().default(false),
  links: z.array(linkSchema).max(20).default([]),
});

export const seriesInputSchema = z.object({
  seriesKey: keySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f0a35b"),
  archived: z.boolean().default(false),
});

export const presetInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  seriesIds: z.array(z.uuid()).min(1).max(100),
});
