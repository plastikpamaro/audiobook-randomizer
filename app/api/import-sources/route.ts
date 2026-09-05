import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { createImportSource, getImportProposals, getImportSources } from "@/lib/online-import-service";

const schema = z.object({
  seriesId: z.uuid(),
  kind: z.enum(["drei_fragezeichen", "tkkg", "csv", "json", "rss"]),
  name: z.string().trim().min(1).max(200),
  url: z.url().nullable().optional(),
});

export async function GET() {
  try {
    await requireApiUser(["owner", "admin"]);
    const [sources, proposals] = await Promise.all([getImportSources(), getImportProposals()]);
    const confirmedIds = new Set(sources.filter((source) => source.confirmed).map((source) => source.id));
    return NextResponse.json({ sources, proposals: proposals.filter((item) => item.status === "pending" && confirmedIds.has(item.sourceId)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser(["owner", "admin"]);
    const input = schema.parse(await jsonBody(request));
    return NextResponse.json({ id: await createImportSource(user.id, input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
