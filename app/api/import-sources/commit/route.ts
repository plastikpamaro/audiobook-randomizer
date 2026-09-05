import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { commitImportPreview } from "@/lib/online-import-service";

const schema = z.object({
  runId: z.uuid(),
  resolutions: z.array(z.object({
    proposalId: z.uuid(),
    action: z.enum(["create", "link", "ignore"]),
    episodeId: z.uuid().optional(),
  })).max(10_000),
});

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser(["owner", "admin"]);
    const input = schema.parse(await jsonBody(request));
    await commitImportPreview(user.id, input.runId, input.resolutions);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
