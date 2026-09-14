import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/errors";

// GET /api/me — the signed-in user and role, or 401.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(user);
  } catch (err) {
    return toErrorResponse(err);
  }
}
