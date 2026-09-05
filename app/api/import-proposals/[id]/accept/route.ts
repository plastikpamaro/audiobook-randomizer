import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { acceptImportProposal } from "@/lib/online-import-service";

const schema = z.object({ episodeId: z.uuid().optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    const input = schema.parse(await jsonBody(request));
    await acceptImportProposal(user.id, id, input.episodeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
