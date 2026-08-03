import { NextResponse, type NextRequest } from "next/server";
import { recordLogin, sessionCookie, signSession, verifyCredentials } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = await verifyCredentials(email, password);
  // One message for every failure mode — a wrong password and an unknown
  // address must be indistinguishable to the caller.
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await recordLogin(user.id);
  const res = NextResponse.json({ user });
  res.cookies.set(sessionCookie(await signSession(user)));
  return res;
}
