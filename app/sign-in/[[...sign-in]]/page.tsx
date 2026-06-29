import Link from "next/link";
import { isLocalPasswordAuthConfigured, safeAuthReturnPath } from "@/lib/server/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect_url?: string }>;
}) {
  const params = await searchParams;
  const returnPath = safeAuthReturnPath(params.redirect_url);
  const configured = isLocalPasswordAuthConfigured();
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-placeholder">
          <p className="microcopy">Internal access</p>
          <h1>Sign in</h1>
          <p>Use the operator-issued username and password to open the CAD workspace.</p>
          {params.error ? <AuthError code={params.error} /> : null}
          <form className="auth-form" method="post" action="/api/auth/login">
            <input type="hidden" name="redirect_url" value={returnPath} />
            <label>
              <span>Username</span>
              <input name="username" autoComplete="username" required disabled={!configured} />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" autoComplete="current-password" required disabled={!configured} />
            </label>
            <button type="submit" disabled={!configured}>
              Sign in
            </button>
          </form>
          {!configured ? (
            <p className="auth-warning">Password login is not configured on this server. Ask the operator to set APP_AUTH_USER, APP_AUTH_PASSWORD, and APP_AUTH_SESSION_SECRET.</p>
          ) : null}
          <div className="auth-actions">
            <Link href="/">Back to landing</Link>
            <Link href="/sign-up">Request access</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthError({ code }: { code: string }) {
  const message =
    code === "not_configured"
      ? "Password login is not configured on this server."
      : "The username or password is incorrect.";
  return <p className="auth-error">{message}</p>;
}
