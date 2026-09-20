import { escapeHtml } from "../domain/text";
import { LABEL_DEMO, LABEL_NO_ISSUE } from "../domain/constants";
import { reasonLabel } from "../domain/reasons";

export function layout(args: {
  title: string;
  demo: boolean;
  mode: string;
  nav?: string;
  body: string;
}): string {
  const banner = args.demo
    ? `<div class="banner" role="status"><strong>${LABEL_DEMO}</strong> — synthetic data. Mutation adapters cannot reach Shopify. Operating mode: ${escapeHtml(args.mode)}.</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(args.title)} · OrderClarity</title>
  <style>
    :root { font-family: Inter, system-ui, sans-serif; color: #1a1c1d; background: #f1f2f4; }
    body { margin: 0; }
    a:focus, button:focus, input:focus, select:focus, textarea:focus { outline: 3px solid #005bd3; outline-offset: 2px; }
    .banner { background: #fff3cd; border-bottom: 1px solid #e0c36c; padding: 0.75rem 1.25rem; }
    header { background: #202223; color: #fff; padding: 0.75rem 1.25rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; }
    header a { color: #fff; }
    main { padding: 1.25rem; max-width: 1100px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; }
    .card { background: #fff; border: 1px solid #d2d5d8; border-radius: 8px; padding: 1rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e1e3e5; vertical-align: top; }
    .tabs a { margin-right: 1rem; }
    .wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
    form { display: grid; gap: 0.5rem; max-width: 36rem; }
    button, .btn { background: #005bd3; color: #fff; border: 0; padding: 0.45rem 0.8rem; border-radius: 6px; cursor: pointer; }
    .muted { color: #616161; }
    @media (max-width: 640px) { table, thead, tbody, th, td, tr { display: block; } th { position: absolute; left: -9999px; } }
  </style>
</head>
<body>
  ${banner}
  <header>
    <strong>OrderClarity</strong>
    <nav aria-label="Primary">
      <a href="/app">Overview</a>
      <a href="/app/queue">Review queue</a>
      <a href="/app/onboarding">Onboarding</a>
      <a href="/app/mapping">Mapping</a>
      <a href="/app/rules">Rules</a>
      <a href="/app/billing">Billing</a>
      <a href="/app/staff">Staff</a>
      <a href="/app/settings">Settings</a>
    </nav>
  </header>
  <main>${args.body}</main>
</body>
</html>`;
}

export function overviewHtml(data: Record<string, unknown>): string {
  const demo = Boolean(data.demo);
  return layout({
    title: "Overview",
    demo,
    mode: String(data.operatingMode ?? "observation"),
    body: `
      <h1>Overview</h1>
      <p>Detected issues are listed separately from integration failures. The app is an additional check — results are never labeled Safe, Guaranteed correct, or AI approved.</p>
      <div class="cards">
        <div class="card"><h2>Unresolved issues</h2><p>${data.unresolvedIssues}</p></div>
        <div class="card"><h2>Unchecked / integration failures</h2><p>${data.uncheckedOrders}</p></div>
        <div class="card"><h2>Processing backlog</h2><p>${data.processingBacklog}</p></div>
        <div class="card"><h2>Operating mode</h2><p>${escapeHtml(String(data.operatingMode))}</p></div>
        <div class="card"><h2>Onboarding</h2><p>${escapeHtml(String(data.onboardingStep))}</p></div>
        <div class="card"><h2>Usage</h2><p>${(data.usage as { consumed: number; entitlement: number }).consumed} / ${(data.usage as { consumed: number; entitlement: number }).entitlement}</p></div>
      </div>
      <p class="muted">Copy: ${LABEL_NO_ISSUE}. Observation default: ${data.observation ? "yes" : "no"}.</p>
    `,
  });
}

export function queueHtml(data: {
  demo: boolean;
  tab: string;
  counts: Record<string, number>;
  rows: Array<Record<string, unknown>>;
}): string {
  const rows = data.rows
    .map(
      (r) => `<tr>
        <td><a href="/app/orders/${escapeHtml(String(r.id))}">${escapeHtml(String(r.displayNumber))}</a></td>
        <td>${escapeHtml(String(r.productSummary))}</td>
        <td>${escapeHtml(String(r.primaryReasonLabel))}</td>
        <td>${escapeHtml(String(r.issueCount))}</td>
        <td>${escapeHtml(String(r.reviewState))}</td>
        <td>${escapeHtml(String(r.processingState))}</td>
        <td>${escapeHtml(String(r.lastEvaluatedAt ?? ""))}</td>
        <td class="wrap">${escapeHtml(String(r.originalNote ?? ""))}</td>
      </tr>`,
    )
    .join("");
  return layout({
    title: "Review queue",
    demo: data.demo,
    mode: "observation",
    body: `
      <h1>Review queue</h1>
      <p class="tabs">
        <a href="/app/queue?tab=open">Open issues (${data.counts.open})</a>
        <a href="/app/queue?tab=unchecked">Unchecked (${data.counts.unchecked})</a>
        <a href="/app/queue?tab=awaiting_customer">Awaiting customer</a>
        <a href="/app/queue?tab=resolved">Resolved</a>
        <a href="/app/queue?tab=no_issue_detected">${LABEL_NO_ISSUE}</a>
      </p>
      <table>
        <thead><tr><th>Order</th><th>Product</th><th>Primary reason</th><th>Issues</th><th>Review</th><th>Processing</th><th>Last evaluated</th><th>Original note</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">No matching orders for this filter.</td></tr>`}</tbody>
      </table>
    `,
  });
}

export function detailHtml(data: {
  demo: boolean;
  order: Record<string, unknown>;
  snapshot: { items: Array<Record<string, unknown>>; originalNote: string } | null;
  findings: Array<Record<string, unknown>>;
  disclaimer: string;
}): string {
  const items = (data.snapshot?.items ?? [])
    .map(
      (item) => `<article class="card">
        <h3>${escapeHtml(String(item.title))} × ${escapeHtml(String(item.quantity))}</h3>
        <p>Variant: ${escapeHtml(JSON.stringify(item.selectedOptions))}</p>
        <p class="wrap">Mapped attributes: ${escapeHtml(JSON.stringify(item.mappedAttributes))}</p>
      </article>`,
    )
    .join("");
  const findings = data.findings
    .map(
      (f) => `<article class="card">
        <h3>${escapeHtml(String(f.reasonLabel))}</h3>
        <p>State: ${escapeHtml(String(f.state))} · Method: ${escapeHtml(String(f.method))} · Check: ${escapeHtml(String(f.checkId))}</p>
        <p class="wrap">Evidence (original values): ${escapeHtml(JSON.stringify(f.originalValues))}</p>
        <form method="post" action="/api/findings/${escapeHtml(String(f.id))}/resolve">
          <input type="hidden" name="evaluationId" value="${escapeHtml(String(data.order.evaluationId ?? ""))}" />
          <input type="hidden" name="rowVersion" value="${escapeHtml(String(f.rowVersion))}" />
          <label>Action
            <select name="action">
              <option value="mark_reviewed">Mark reviewed</option>
              <option value="awaiting_customer">Awaiting customer</option>
              <option value="dismiss">Dismiss finding</option>
              <option value="reopen">Reopen</option>
            </select>
          </label>
          <label>Resolution category <input name="resolutionCategory" /></label>
          <label>Dismiss reason <input name="dismissReason" /></label>
          <label>Note <textarea name="note"></textarea></label>
          <button type="submit">Submit</button>
        </form>
      </article>`,
    )
    .join("");
  return layout({
    title: String(data.order.displayNumber),
    demo: data.demo,
    mode: "observation",
    body: `
      <h1>${escapeHtml(String(data.order.displayNumber))}</h1>
      <p><a href="${escapeHtml(String((data as { shopifyOrderUrl?: string }).shopifyOrderUrl ?? "#"))}">Open in Shopify</a></p>
      <p class="wrap">Order note: ${escapeHtml(data.snapshot?.originalNote ?? "")}</p>
      <p>${escapeHtml(data.disclaimer)}</p>
      <h2>Line items</h2>${items}
      <h2>Findings</h2>${findings || `<p>${LABEL_NO_ISSUE}</p>`}
    `,
  });
}

export function simplePage(title: string, demo: boolean, inner: string): string {
  return layout({ title, demo, mode: "observation", body: inner });
}

export { reasonLabel };
