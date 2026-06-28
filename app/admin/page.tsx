import { getAdminSummary } from "@/lib/server/admin-summary";
import { adminRouteAccess, getPageAuthContext } from "@/lib/server/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const auth = await getPageAuthContext();
  const access = adminRouteAccess(auth);
  if (access === "sign_in") {
    redirect("/sign-in?redirect_url=/admin");
  }
  if (access === "forbidden") {
    redirect("/app");
  }
  const summary = await getAdminSummary();

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="microcopy">Internal alpha dashboard</p>
          <h1>Staging health and usage</h1>
        </div>
        <span>{summary.generatedAt}</span>
      </header>

      <section className="admin-grid">
        <MetricCard label="Total users" value={summary.totalUsers} />
        <MetricCard label="Total projects" value={summary.totalProjects} />
        <MetricCard label="Total runs" value={summary.totalRuns} />
        <MetricCard label="Success / failure" value={`${summary.successCount} / ${summary.failureCount}`} />
      </section>

      <section className="admin-grid">
        <MetricCard label="P95 duration" value={`${summary.p95DurationMs} ms`} />
        <MetricCard label="New unexpected failures" value={summary.newUnexpectedFailures} tone={summary.newUnexpectedFailures ? "warn" : "ok"} />
      </section>

      <section className="admin-grid two">
        <AdminPanel title="Protocol status">
          {summary.protocolStatus ? (
            <ul>
              <li>Executed: {String(summary.protocolStatus.executed)}</li>
              <li>Total: {summary.protocolStatus.total}</li>
              <li>Passed: {summary.protocolStatus.passed}</li>
              <li>Failed: {summary.protocolStatus.failed}</li>
              <li>Updated: {summary.protocolStatus.generatedAt || "unknown"}</li>
            </ul>
          ) : (
            <p>No protocol output found.</p>
          )}
        </AdminPanel>
        <AdminPanel title="Latest smoke">
          {summary.latestSmoke ? (
            <ul>
              <li>Passed: {String(summary.latestSmoke.ok)}</li>
              <li>Access mode: {summary.latestSmoke.accessMode}</li>
              <li>HTTPS configured: {String(summary.latestSmoke.httpsConfigured)}</li>
              <li>Updated: {summary.latestSmoke.generatedAt || "unknown"}</li>
              <li>Warning: {summary.latestSmoke.warning || "none"}</li>
            </ul>
          ) : (
            <p>No smoke output found.</p>
          )}
        </AdminPanel>
        <AdminPanel title="Part type distribution">
          <CountList counts={summary.runsByPartType} />
        </AdminPanel>
        <AdminPanel title="Trial feedback">
          <ul>
            <li>Total: {summary.feedback.total}</li>
            <li>Positive: {summary.feedback.positive}</li>
            <li>Negative: {summary.feedback.negative}</li>
            <li>
              Negative revision IDs:{" "}
              {summary.feedback.negativeRevisionIds.length ? summary.feedback.negativeRevisionIds.join(", ") : "none"}
            </li>
          </ul>
        </AdminPanel>
        <AdminPanel title="Data layer">
          <ul>
            <li>Mode: {summary.dataLayer.mode}</li>
            <li>Project store: {summary.dataLayer.projectStore}</li>
            <li>Migration: {summary.dataLayer.migrationPath}</li>
            <li>Production ready: {String(summary.dataLayer.productionReady)}</li>
          </ul>
        </AdminPanel>
      </section>
    </main>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  return (
    <article className={tone ? `admin-card ${tone}` : "admin-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AdminPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="admin-panel">
      <h2>{title}</h2>
      {children}
    </article>
  );
}

function CountList({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  if (!entries.length) return <p>none</p>;
  return (
    <ul>
      {entries.map(([key, value]) => (
        <li key={key}>
          {key}: {value}
        </li>
      ))}
    </ul>
  );
}
