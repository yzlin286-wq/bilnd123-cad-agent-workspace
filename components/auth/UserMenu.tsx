import Link from "next/link";
import { appRouteAccess, getPageAuthContext } from "@/lib/server/auth";

export async function UserMenu() {
  const auth = await getPageAuthContext();
  if (appRouteAccess(auth) !== "allow") return null;
  return (
    <form className="user-menu" method="post" action="/api/auth/logout">
      <Link href="/app">{auth.email || "Internal account"}</Link>
      <button type="submit">Sign out</button>
    </form>
  );
}
