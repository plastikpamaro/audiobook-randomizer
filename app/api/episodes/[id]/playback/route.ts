import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { getEpisodeAudioUrl } from "@/lib/audio";
import { AppError, assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { claimPlayback, getPlaybackProgress, savePlaybackProgress } from "@/lib/playback";

export const runtime = "nodejs";

const claimSchema = z.object({ sessionId: z.uuid() });
const saveSchema = z.object({
  sessionId: z.uuid(),
  sequence: z.number().int().min(1).max(2_147_483_647),
  positionSeconds: z.number().min(0).max(604_800),
  durationSeconds: z.number().positive().max(604_800),
  finished: z.boolean(),
}).refine((value) => value.positionSeconds <= value.durationSeconds, "Die Hörposition liegt außerhalb der Folge.");

type Context = { params: Promise<{ id: string }> };

async function audioEpisode(context: Context): Promise<string> {
  const id = z.uuid().parse((await context.params).id);
  if (!await getEpisodeAudioUrl(id)) throw new AppError("Für diese Folge ist keine Originalfassung vorhanden.", 404, "AUDIO_NOT_FOUND");
  return id;
}

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const id = await audioEpisode(context);
    return NextResponse.json({ progress: await getPlaybackProgress(user.id, id) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const id = await audioEpisode(context);
    const input = claimSchema.parse(await jsonBody(request));
    return NextResponse.json({ progress: await claimPlayback(user.id, id, input.sessionId) });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const id = z.uuid().parse((await context.params).id);
    const input = saveSchema.parse(await jsonBody(request));
    return NextResponse.json({ progress: await savePlaybackProgress(user.id, id, input) });
  } catch (error) { return errorResponse(error); }
}
