import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getAnalytics } from "@/lib/analytics";
import { localDate } from "@/lib/dates";
import { errorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const to = url.searchParams.get("to") || localDate();
    const fromParam = url.searchParams.get("from");
    let from = fromParam || to;
    if (!fromParam && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      const defaultFrom = new Date(`${to}T12:00:00Z`);
      if (!Number.isNaN(defaultFrom.valueOf())) {
        defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
        from = defaultFrom.toISOString().slice(0, 10);
      }
    }
    return NextResponse.json({ analytics: await getAnalytics(user.id, from, to) });
  } catch (error) {
    return errorResponse(error);
  }
}
