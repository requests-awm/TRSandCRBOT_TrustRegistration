# Requirements session guide

For each question you plan to ask: what the prototype does today, and what a given answer would change.
Use it to steer the demo and to write the decisions straight into the "Decision" column afterwards.

Defaults that are configuration, not code, are marked **(config)**. Change them in `.env.local` without a release.

## Scope and volume

| Question | Prototype today | If the answer is… | Decision |
|---|---|---|---|
| Trusts per month, open now, growth, spikes | Reports → "Volume by month" and "Open cases by age" compute this from real data once cases exist | Any | |
| Which providers, per-provider evidence rules | Provider is free text with suggestions; per-provider rules not modelled | Providers have different evidence rules → add a provider reference list with "accepts reference only / needs certificate" | |
| Is "both" real; does one complete before the other | Both supported in parallel; Reports → "Jurisdiction mix" shows the split | Sequencing required → add a precondition to START_REGISTRATION on the second authority | |

## The process as it runs today

| Question | Prototype today | If the answer is… | Decision |
|---|---|---|---|
| Walk through the last trust; handoffs; where it stalled | Every step is an event on the timeline; "Stalled" tile and card badge after **STALE_AFTER_DAYS** (config, 14) | Handoffs happen in Teams/Asana → notifications could post there instead of email | |
| Who submits to HMRC / CRBOT | AEP records "Submitted to authority"; agent/client submission is recorded the same way with a note | Client or agent submits → add "submitted by" field and an "awaiting third-party confirmation" state | |
| Who owns chasing; how long is too long | Owner picker + "Assign to me" on the case; weekly stalled nudge to owner via daily job; threshold **(config)** | 7 / 14 / 28 days → set `STALE_AFTER_DAYS` and `NEXT_PUBLIC_STALE_AFTER_DAYS` | |
| What triggers the process; can a trust be missed | WM raises a request; nothing detects trusts that were never logged | Provider application drafting is the trigger → consider a feed from that system, or a periodic reconciliation against Insightly | |

## Status and data

| Question | Prototype today | If the answer is… | Decision |
|---|---|---|---|
| Three statuses vs sub-statuses; what WM sees | Headline (not started / in progress / completed) plus 12 detailed states incl. awaiting information, authority query, evidence rejected. WM sees headline first, detail on the case | WM must not see detail → hide detailed badges for the WM role | |
| Data per trust (settlor, trustees, product, policy no., URN) | Captures client, Insightly ID, trust name/type/creation date, provider/country, priority, target date, authority reference (URN/UTR/register no.) | Settlor/trustees needed → new nullable columns; treat as personal data (RLS already on, retention policy applies) | |
| What counts as confirmation; who verifies | Typed evidence per authority (TRS proof of registration, URN, UTR; CRBOT confirmation, register number), SHA-256, versions; a second person must verify (maker-checker) | Upload alone is sufficient → make verification optional per authority | |
| Annual review / TRS 90-day updates | Not in scope; no recurring reminders after closure | Later → add a "next review" date and a reminder in the daily job | |

## People and permissions

| Question | Prototype today | If the answer is… | Decision |
|---|---|---|---|
| Who is on AEP / WM; who else needs visibility | Six roles: WM requester, AEP processor, AEP reviewer, compliance reviewer, administrator, auditor. WM sees own team only; auditor/compliance read everything | Ops managers need read access → auditor role | |
| Can WM edit | WM: raise request, download verified certificates, close the case. Nothing else | | |
| Accountable person; sign-off step | Activation gate is automatic once all required registrations are verified; no separate sign-off | Sign-off required → add a compliance approval transition before "ready for provider" | |

## Notifications and hand-back

| Question | Prototype today | If the answer is… | Decision |
|---|---|---|---|
| When to tell WM; channel | Email at milestones: gate opened, hand-back, and weekly if stalled. **WM_NOTIFY_ON=all** (config) emails every status change instead | Teams / Asana → add a provider for that channel (same interface as email) | |
| How the certificate reaches the provider | WM downloads via 5-minute signed links from the case page; hand-back email lists the certificates | Must land in Drive/SharePoint → add a "deliver to folder" step using the Drive API | |

## Compliance and audit

| Question | Prototype today | If the answer is… | Decision |
|---|---|---|---|
| Who audits; what they ask to see | Per-case **Audit pack** (print / PDF): request, decisions, references, evidence with hashes and verifiers, full append-only trail. Cross-case audit log with CSV export | | |
| Retention; hosting region | Data in the shared AWM Supabase project (EU region), private bucket; nothing is hard-deleted; 7-year retention stated on the pack | UK-only hosting → would need a UK-region project | |

## Systems and constraints

| Question | Prototype today | If the answer is… | Decision |
|---|---|---|---|
| Where records are mastered; pull names | Request form searches `public.insightly_contacts` (the AWM client master) and fills Insightly ID + name; manual entry still allowed | Xplan / Intelliflo → would need their API; Insightly stays the join key | |
| Sit inside Asana/SharePoint or stand alone; who maintains | Stand-alone Next.js app on Cloud Run against the shared Supabase project; Asana-style board view | Asana required → sync cases as Asana tasks via the existing `asana_*` reference tables | |
| Build vs buy; deadline | Built; runs today against the live database | | |

## Success and rollout

| Question | Prototype today | If the answer is… | Decision |
|---|---|---|---|
| Success in three months; how measured | Reports page: volume, time to registration (median days), age of open book, overdue and stalled list | Agree targets (e.g. median ≤ N days, zero overdue) and add them as thresholds | |
| Pilot; run alongside | Any number of live trusts; nothing prevents parallel running | | |
| Prototype feedback; what stops daily use | Capture here | | |

## Fifteen-minute version

1. Process as it runs today → drives the stalled threshold, owner model and any third-party-submission state.
2. Definition of confirmation per authority → drives evidence types and whether verification is mandatory.
3. Notifications → drives `WM_NOTIFY_ON` and whether a Teams/Asana channel is needed.
