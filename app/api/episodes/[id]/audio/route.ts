import { requireApiUser } from "@/lib/auth";
import { audioResponse } from "@/lib/audio";
import { errorResponse } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

async function serve(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    return await audioResponse(request, uuidSchema.parse(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = serve;
export const HEAD = serve;
