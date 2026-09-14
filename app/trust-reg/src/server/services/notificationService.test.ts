import { afterEach, describe, expect, it } from "vitest";
import { ConsoleNotificationProvider, ResendNotificationProvider, SendGridNotificationProvider, getNotificationProvider, renderNotification } from "./notificationService";

const base = { caseReference: "NTR-2026-000007", trustName: "Whitcombe Loan Trust", trustCaseId: "abc", provider: "Prudential International" };

describe("renderNotification", () => {
  it("prefixes every subject with the case reference", () => {
    for (const t of ["ready_for_provider", "handed_back_to_wm", "authority_query", "evidence_rejected", "evidence_verified", "deadline_approaching"] as const) {
      expect(renderNotification(t, base).subject.startsWith("[NTR-2026-000007]")).toBe(true);
    }
  });

  it("links back to the case page", () => {
    const m = renderNotification("ready_for_provider", base);
    expect(m.text).toContain("/cases/abc");
    expect(m.html).toContain('href="http://localhost:3000/cases/abc"');
  });

  it("lists certificates and the AEP note on hand-back", () => {
    const m = renderNotification("handed_back_to_wm", { ...base, certificates: ["trs_proof.pdf", "crbot_conf.pdf"], comment: "Submit both to Prudential" });
    expect(m.text).toContain("Certificate: trs_proof.pdf");
    expect(m.text).toContain("Certificate: crbot_conf.pdf");
    expect(m.text).toContain("Note from AEP: Submit both to Prudential");
  });

  it("escapes HTML in user-supplied text", () => {
    const m = renderNotification("evidence_rejected", { ...base, reason: '<img src=x onerror="alert(1)">' });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img");
    expect(m.text).toContain("<img");
  });

  it("states days remaining and the deadline for reminders", () => {
    const m = renderNotification("deadline_approaching", { ...base, authority: "TRS", deadline: "2026-10-01", daysRemaining: 9, status: "submitted" });
    expect(m.subject).toContain("TRS registration deadline in 9 days");
    expect(m.text).toContain("2026-10-01");
  });
});

describe("getNotificationProvider", () => {
  const original = process.env.NOTIFICATION_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.NOTIFICATION_PROVIDER;
    else process.env.NOTIFICATION_PROVIDER = original;
  });

  it("defaults to console", () => {
    delete process.env.NOTIFICATION_PROVIDER;
    expect(getNotificationProvider()).toBeInstanceOf(ConsoleNotificationProvider);
  });

  it("selects Resend and SendGrid case-insensitively", () => {
    process.env.NOTIFICATION_PROVIDER = "Resend";
    expect(getNotificationProvider()).toBeInstanceOf(ResendNotificationProvider);
    process.env.NOTIFICATION_PROVIDER = "SENDGRID";
    expect(getNotificationProvider()).toBeInstanceOf(SendGridNotificationProvider);
  });

  it("falls back to console for unknown names", () => {
    process.env.NOTIFICATION_PROVIDER = "carrier-pigeon";
    expect(getNotificationProvider()).toBeInstanceOf(ConsoleNotificationProvider);
  });

  it("email providers fail cleanly without an API key", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    const msg = { subject: "s", text: "t", html: "<p>t</p>" };
    expect(await new ResendNotificationProvider().deliver("a@b.c", msg)).toMatchObject({ success: false, error: /RESEND_API_KEY/ });
    expect(await new SendGridNotificationProvider().deliver("a@b.c", msg)).toMatchObject({ success: false, error: /SENDGRID_API_KEY/ });
  });
});
