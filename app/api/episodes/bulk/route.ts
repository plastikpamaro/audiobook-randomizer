import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { applyBulkEpisodeAction } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({
  episodeIds: z.array(z.uuid()).min(1).max(1_000),
  action: z.enum(["heard", "available", "archive", "unarchive"]),
});

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const input = schema.parse(await jsonBody(request));
    if (["archive", "unarchive"].includes(input.action) && !["owner", "admin"].includes(user.role)) {
      return NextResponse.json({ error: "Dafür fehlen dir die Rechte.", code: "FORBIDDEN" }, { status: 403 });
    }
    await applyBulkEpisodeAction(user.id, input.episodeIds, input.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
