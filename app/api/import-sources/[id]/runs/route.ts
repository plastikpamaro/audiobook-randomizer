import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getImportProposals, getImportRuns } from "@/lib/online-import-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    const [runs, proposals] = await Promise.all([getImportRuns(id), getImportProposals(id)]);
    return NextResponse.json({ runs, proposals });
  } catch (error) {
    return errorResponse(error);
  }
}
