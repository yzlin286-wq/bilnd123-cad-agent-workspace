import Link from "next/link";
import { safeAuthReturnPath, signInRedirectPath } from "@/lib/server/auth";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const params = await searchParams;
  const returnPath = safeAuthReturnPath(params.redirect_url);
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-placeholder">
          <p className="microcopy">Managed access</p>
          <h1>Request access from the operator</h1>
          <p>Self-registration is disabled for this internal alpha. Use the issued username and password to sign in.</p>
          <Link href={signInRedirectPath(returnPath)}>Back to sign in</Link>
        </div>
      </section>
    </main>
  );
}
