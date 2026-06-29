import { NextResponse } from "next/server";
import {
  createLocalSessionToken,
  isLocalPasswordAuthConfigured,
  isLocalSessionCookieSecure,
  LOCAL_SESSION_COOKIE_NAME,
  LOCAL_SESSION_TTL_SECONDS,
  publicRequestUrl,
  safeAuthReturnPath,
  verifyLocalPassword,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const returnPath = safeAuthReturnPath(String(formData.get("redirect_url") || "/app"));

  if (!isLocalPasswordAuthConfigured()) {
    return redirectToSignIn(request, returnPath, "not_configured");
  }
  if (!verifyLocalPassword(username, password)) {
    return redirectToSignIn(request, returnPath, "invalid");
  }

  const token = createLocalSessionToken(username);
  if (!token) {
    return redirectToSignIn(request, returnPath, "not_configured");
  }

  const response = NextResponse.redirect(publicRequestUrl(request, returnPath), { status: 303 });
  response.cookies.set(LOCAL_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isLocalSessionCookieSecure(),
    path: "/",
    maxAge: LOCAL_SESSION_TTL_SECONDS,
  });
  return response;
}

function redirectToSignIn(request: Request, returnPath: string, error: "invalid" | "not_configured") {
  const url = publicRequestUrl(request, "/sign-in");
  url.searchParams.set("redirect_url", returnPath);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, { status: 303 });
}
