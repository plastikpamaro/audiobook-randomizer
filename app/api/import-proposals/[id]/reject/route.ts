import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse } from "@/lib/http";
import { rejectImportProposal } from "@/lib/online-import-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    await rejectImportProposal(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
