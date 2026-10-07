import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { setActivePreset } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const activePresetSchema = z.object({ presetId: z.uuid().nullable() });

export async function PUT(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { presetId } = activePresetSchema.parse(await jsonBody(request));
    await setActivePreset(user.id, presetId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
