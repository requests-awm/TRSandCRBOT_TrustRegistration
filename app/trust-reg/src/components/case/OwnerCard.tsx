"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import type { ProfileSummary } from "@/lib/api";
import type { TrustCaseWithRequirements } from "@/server/domain/types";
import { ROLE_LABEL, formatDate } from "@/lib/labels";
import { STALE_AFTER_DAYS, daysSince, isStalled } from "@/lib/staleness";
import { Alert, Button, Card, Select } from "@/components/ui";
import { Avatar } from "@/components/dashboard/BoardView";

const AEP_ROLES = ["aep_processor", "aep_reviewer", "administrator"] as const;

// Who is chasing this case. Answers "who owns chasing" per case and shows how long it has sat idle.
export function OwnerCard({ trustCase, onChanged }: { trustCase: TrustCaseWithRequirements; onChanged: () => Promise<unknown> | void }) {
  const { api, user } = useSession();
  const [people, setPeople] = useState<ProfileSummary[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAssign = !!user && (AEP_ROLES as readonly string[]).includes(user.role);

  useEffect(() => {
    let cancelled = false;
    api
      .listProfiles([...AEP_ROLES])
      .then((p) => !cancelled && setPeople(p))
      .catch(() => !cancelled && setPeople([]));
    return () => {
      cancelled = true;
    };
  }, [api, user?.role]);

  const owner = people?.find((p) => p.id === trustCase.assigned_aep_user_id);
  const ownerName = trustCase.assigned_aep_user_id ? owner?.fullName ?? "AEP colleague" : undefined;
  const idle = daysSince(trustCase.updated_at);
  const stalled = isStalled(trustCase);

  const assign = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.assignOwner(trustCase.id, id || null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign owner");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Owner and activity">
      <div className="flex items-center gap-3">
        <Avatar name={ownerName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{ownerName ?? "Unassigned"}</div>
          <div className="text-xs text-slate-500">
            {owner ? ROLE_LABEL[owner.role] : trustCase.assigned_aep_user_id ? "AEP" : "No AEP owner yet"}
          </div>
        </div>
      </div>

      {canAssign && (
        <div className="mt-3 flex items-center gap-2">
          <Select value={trustCase.assigned_aep_user_id ?? ""} onChange={(e) => assign(e.target.value)} disabled={saving || !people} className="flex-1">
            <option value="">Unassigned</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {ROLE_LABEL[p.role]}
              </option>
            ))}
          </Select>
          {user && trustCase.assigned_aep_user_id !== user.id && (
            <Button size="sm" variant="secondary" onClick={() => assign(user.id)} disabled={saving}>
              Assign to me
            </Button>
          )}
        </div>
      )}
      {people && people.length === 0 && canAssign && (
        <p className="mt-2 text-xs text-slate-500">No AEP profiles yet. Add rows to trust_reg.profiles to populate this list.</p>
      )}
      {error && (
        <div className="mt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <dt className="text-slate-500">Last activity</dt>
        <dd className={stalled ? "font-medium text-amber-700" : ""}>
          {formatDate(trustCase.updated_at, true)} ({idle}d ago)
        </dd>
        <dt className="text-slate-500">Chase threshold</dt>
        <dd>{STALE_AFTER_DAYS} days</dd>
      </dl>
      {stalled && (
        <div className="mt-2">
          <Alert tone="warning">No activity for {idle} days. The owner is nudged weekly by the daily job.</Alert>
        </div>
      )}
    </Card>
  );
}
