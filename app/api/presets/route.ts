import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getPresets, savePreset } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { presetInputSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ presets: await getPresets(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const input = presetInputSchema.parse(await jsonBody(request));
    return NextResponse.json({ id: await savePreset(user.id, input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
