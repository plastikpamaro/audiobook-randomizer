import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getHistory } from "@/lib/randomizer";
import { errorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    return NextResponse.json({ items: await getHistory(user.id, 100, offset) });
  } catch (error) {
    return errorResponse(error);
  }
}
