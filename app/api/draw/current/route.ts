import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getCurrentDraw } from "@/lib/randomizer";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ draw: await getCurrentDraw(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
