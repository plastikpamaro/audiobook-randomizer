import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { resolveImportProposals } from "@/lib/online-import-service";

const schema = z.object({ proposalIds: z.array(z.uuid()).min(1).max(1000), action: z.enum(["accept", "reject"]) });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser(["owner", "admin"]);
    const input = schema.parse(await jsonBody(request));
    await resolveImportProposals(user.id, input.proposalIds, input.action);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
