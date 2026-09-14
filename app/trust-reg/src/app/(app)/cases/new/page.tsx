"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import { ApiError, type CreateCaseInput } from "@/lib/api";
import { BUSINESS_PRIORITIES } from "@/server/domain/types";
import { PRIORITY_LABEL } from "@/lib/labels";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

// PLACEHOLDER lists. Replace with values from public.insightly_contacts / provider reference data.
const PROVIDER_COUNTRIES = ["Ireland", "Isle of Man", "Guernsey", "Jersey", "Luxembourg", "United Kingdom", "Other"];
const TRUST_TYPES = ["Discretionary trust", "Interest in possession trust", "Loan trust", "Gift trust", "Pilot trust", "Charitable trust", "Bare trust", "Other"];

const empty: CreateCaseInput = {
  insightlyId: "",
  clientDisplayName: "",
  trustName: "",
  providerName: "",
  providerCountry: "Ireland",
  trustType: "Discretionary trust",
  trustCreationDate: "",
  requestingWmTeam: "",
  businessPriority: "standard",
  targetProviderSubmissionDate: "",
};

export default function NewCasePage() {
  const router = useRouter();
  const { api, user } = useSession();
  const [form, setForm] = useState<CreateCaseInput>({ ...empty, requestingWmTeam: user?.wmTeam ?? "" });
  const [errors, setErrors] = useState<Partial<Record<keyof CreateCaseInput, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const set = (k: keyof CreateCaseInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const canCreate = user && ["wm_requester", "administrator"].includes(user.role);

  const validate = () => {
    const next: typeof errors = {};
    if (!form.insightlyId.trim()) next.insightlyId = "Required";
    if (!form.clientDisplayName.trim()) next.clientDisplayName = "Required";
    if (!form.trustName.trim()) next.trustName = "Required";
    if (!form.providerName.trim()) next.providerName = "Required";
    if (!form.requestingWmTeam.trim()) next.requestingWmTeam = "Required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const created = await api.createCase({
        ...form,
        trustCreationDate: form.trustCreationDate || undefined,
        targetProviderSubmissionDate: form.targetProviderSubmissionDate || undefined,
      });
      router.push(`/cases/${created.id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Could not create the request");
      setSubmitting(false);
    }
  };

  if (user && !canCreate) {
    return <Alert tone="warning">Only WM requesters and administrators can raise a registration request.</Alert>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New registration request</h1>
        <p className="text-sm text-slate-600">Log a non-AEP provider trust that may need UK TRS or Irish CRBOT registration. AEP will decide the requirement.</p>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <Card title="Client and trust">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Insightly ID" required error={errors.insightlyId} hint="Client record in Insightly">
              <Input value={form.insightlyId} onChange={set("insightlyId")} placeholder="INS-123456" />
            </Field>
            <Field label="Client display name" required error={errors.clientDisplayName}>
              <Input value={form.clientDisplayName} onChange={set("clientDisplayName")} placeholder="Surname, First name" />
            </Field>
            <Field label="Trust name" required error={errors.trustName}>
              <Input value={form.trustName} onChange={set("trustName")} />
            </Field>
            <Field label="Trust type" required>
              <Select value={form.trustType} onChange={set("trustType")}>
                {TRUST_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Trust creation date">
              <Input type="date" value={form.trustCreationDate} onChange={set("trustCreationDate")} />
            </Field>
          </div>
        </Card>

        <Card title="Provider">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider name" required error={errors.providerName}>
              <Input value={form.providerName} onChange={set("providerName")} placeholder="e.g. Utmost International" />
            </Field>
            <Field label="Provider country" required>
              <Select value={form.providerCountry} onChange={set("providerCountry")}>
                {PROVIDER_COUNTRIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Request">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Requesting WM team" required error={errors.requestingWmTeam}>
              <Input value={form.requestingWmTeam} onChange={set("requestingWmTeam")} />
            </Field>
            <Field label="Business priority" required>
              <Select value={form.businessPriority} onChange={set("businessPriority")}>
                {BUSINESS_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Target provider submission date" hint="When WM needs the trust ready for the provider">
              <Input type="date" value={form.targetProviderSubmissionDate} onChange={set("targetProviderSubmissionDate")} />
            </Field>
          </div>
        </Card>

        {serverError && <Alert tone="error">{serverError}</Alert>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create request"}
          </Button>
        </div>
      </form>
    </div>
  );
}
