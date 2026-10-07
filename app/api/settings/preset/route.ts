import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { setActivePreset } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const activePresetSchema = z.object({
  presetId: z.uuid().nullable(),
  seriesIds: z.array(z.uuid()).max(100).optional(),
}).refine((input) => input.seriesIds === undefined || input.presetId === null, {
  message: "Serien können nur für die freie Auswahl gespeichert werden.",
  path: ["seriesIds"],
});

export async function PUT(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { presetId, seriesIds } = activePresetSchema.parse(await jsonBody(request));
    if (seriesIds === undefined) await setActivePreset(user.id, presetId);
    else await setActivePreset(user.id, presetId, seriesIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
