import { NextResponse } from "next/server";
import { isLocalSessionCookieSecure, LOCAL_SESSION_COOKIE_NAME, publicRequestUrl } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = NextResponse.redirect(publicRequestUrl(request, "/sign-in"), { status: 303 });
  response.cookies.set(LOCAL_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isLocalSessionCookieSecure(),
    path: "/",
    maxAge: 0,
  });
  return response;
}
