# Proposal: A2P 10DLC SMS Compliance Registration API

**Status:** Draft
**Author:** Engineering
**Date:** 2026-07-12
**Related:** `app/services/clients/twilio_client.py`, `app/api/routers/organizations.py`, [Twilio ISV Sole Prop API](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api-sole-prop-new), [Twilio ISV Standard API](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api-standard)

---

## Problem

Mirenta already provisions per-org Twilio ISV resources at org creation:

- Twilio subaccount
- US local SMS+voice number
- Messaging Service (number attached)

Inbound voice and SMS work immediately. **Outbound US SMS is filtered or blocked** until the org completes A2P 10DLC Brand + Campaign registration under that subaccount.

Today this step is manual (Twilio Console). Competitors like Beside/M1 hide the friction by offering two lanes:

| Lane | Who it's for | Time to outbound SMS | Isolation |
|------|--------------|----------------------|-----------|
| **Sole Proprietor** | Individual operators without EIN | Minutes–hours (OTP + algorithmic vetting) | Per-org brand/campaign in subaccount |
| **Standard / Low-Volume Standard** | LLCs, corporations, higher volume | Brand: minutes; Campaign: 3–15 business days | Per-org brand/campaign in subaccount |

This proposal adds **two explicit API registration paths** so the dashboard can onboard orgs into either lane without Console work, while preserving Mirenta's existing ISV subaccount-per-org model.

---

## Goals

1. Expose two registration options via API: `sole_proprietor` (fast lane) and `standard` (business lane).
2. Automate the Twilio Trust Hub + Brand + Campaign API sequence inside each org's existing subaccount.
3. Track registration state in Postgres so the UI can show progress (pending OTP, vetting, active, failed).
4. Gate outbound SMS on `sms_compliance_status = active` (inbound SMS and voice remain available throughout).
5. Support a later **upgrade** from sole prop → standard without downtime (parallel registration + cutover).

## Non-goals (this phase)

- Parent-account "umbrella campaign" (Strategy 2 from competitive analysis) — higher platform risk; defer unless product explicitly wants instant zero-wait SMS at Mirenta's compliance liability.
- Toll-free verification as a third lane.
- Automating Mirenta's own Primary Customer Profile (one-time parent setup in Twilio Console).
- Changing the existing org-creation Twilio provisioning flow (subaccount + number + Messaging Service stays as-is).

---

## Current state

| Piece | Status |
|-------|--------|
| Subaccount + number + Messaging Service | `provision_org_twilio()` on `POST /organizations` |
| A2P Brand/Campaign | Not automated (`docs/configuration.md` notes manual follow-up) |
| Outbound SMS send path | `send_sms()` via org Messaging Service SID |
| Content guardrails | LangGraph `output_guardrails` (STOP language, length, PII) |
| Compliance guardrails | `decision/guardrails.py` (DNC, consent, frequency) |

**Gap:** No `sms_compliance_status`, no Trust Hub integration, no Twilio status webhooks for brand/campaign lifecycle.

---

## Architecture overview

```mermaid
sequenceDiagram
    participant UI as Dashboard
    participant API as FastAPI
    participant DB as Postgres
    participant TW as Twilio (subaccount)
    participant TCR as The Campaign Registry

    UI->>API: POST /organizations/{id}/sms-compliance (lane + fields)
    API->>DB: Insert org_sms_compliance (status=pending)
    API->>TW: Trust Hub profile + EndUser + SupportingDocument
    API->>TW: BrandRegistration (SOLE_PROPRIETOR or STANDARD)
    TW->>TCR: Brand vetting
    alt Sole Proprietor
        TCR-->>UI: OTP SMS to user's mobile (reply YES)
        TCR->>API: brand_registration.approved webhook
    else Standard
        Note over TCR: Brand minutes; Campaign days
        TCR->>API: campaign registration status webhooks
    end
    API->>TW: Create A2P Campaign + link Messaging Service
    API->>DB: status=active
    API-->>UI: Compliance status resource
```

Registration runs **in the org's subaccount** (not parent account), matching existing ISV isolation. Mirenta's parent account holds the ISV Primary Customer Profile (Console setup, once).

---

## API design

### New resource: `SmsComplianceRegistration`

Mounted under organizations. Admin-only (org `owner` or `admin` via existing RLS).

#### `GET /api/organizations/{org_id}/sms-compliance`

Returns current registration state (or `404` / `not_started` if never submitted).

```json
{
  "org_id": "uuid",
  "lane": "sole_proprietor",
  "status": "pending_otp",
  "brand_status": "pending",
  "campaign_status": "not_started",
  "failure_code": null,
  "failure_message": null,
  "limits": {
    "max_numbers": 1,
    "max_mps": 1,
    "max_daily_segments": 3000
  },
  "submitted_at": "2026-07-12T20:00:00Z",
  "activated_at": null,
  "upgrade": {
    "target_lane": null,
    "status": null
  }
}
```

#### `POST /api/organizations/{org_id}/sms-compliance`

Start registration. **Idempotent:** if a registration is `in_progress` or `active` for the same lane, return `409` with current state; if `failed`, allow retry with `?retry=true`.

**Request body — discriminated union on `lane`:**

##### Lane A: `sole_proprietor` (fast / auto-vetting)

```json
{
  "lane": "sole_proprietor",
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@example.com",
  "mobile_phone": "+15551234567",
  "address": {
    "street": "123 Main St",
    "city": "San Francisco",
    "region": "CA",
    "postal_code": "94105",
    "country": "US"
  }
}
```

**Validation rules (API layer):**

- `first_name` + `last_name` must look like a person's name (reject LLC/Inc/Corp patterns → suggest `standard` lane).
- `mobile_phone` must be US/CA; not the org's Twilio number; not VoIP ranges where detectable.
- `email` must pass format + disposable-domain blocklist.
- One active sole-prop registration per org; mobile used for ≤3 sole-prop brands globally (Twilio/TCR limit — surface clear error if Twilio returns limit exceeded).

**Backend auto-fills (not user-editable):** campaign sample messages, opt-in/opt-out copy, message flow, use case — derived from Mirenta's controlled agent templates (see [Platform-owned campaign copy](#platform-owned-campaign-copy)).

##### Lane B: `standard` (business / EIN required)

```json
{
  "lane": "standard",
  "brand_type": "low_volume_standard",
  "legal_business_name": "Apex Logistics LLC",
  "ein": "12-3456789",
  "website_url": "https://apex.example.com",
  "email": "compliance@apex.example.com",
  "address": {
    "street": "500 Market St",
    "city": "San Francisco",
    "region": "CA",
    "postal_code": "94105",
    "country": "US"
  },
  "authorized_representative": {
    "first_name": "Alex",
    "last_name": "Smith",
    "email": "alex@apex.example.com",
    "phone": "+15559876543",
    "job_title": "Owner"
  }
}
```

`brand_type` enum: `low_volume_standard` (default) | `standard` (higher throughput, longer vetting).

**Validation rules:**

- `ein` required (US) or equivalent business number (CA).
- `legal_business_name` required — must not be sole "First Last" personal name without business entity.
- `website_url` required for standard campaigns (Twilio campaign best practices).

#### `POST /api/organizations/{org_id}/sms-compliance/upgrade`

Start sole prop → standard migration (see [Upgrade path](#upgrade-path-sole-prop--standard)). Body same as `standard` lane registration. Keeps sole prop active until new campaign is verified.

#### `DELETE /api/organizations/{org_id}/sms-compliance` (optional, phase 2)

Admin-only teardown of campaign/brand in Twilio + mark `canceled`. Rare; mostly for offboarding.

### Webhook (new, unauthenticated Twilio signature)

#### `POST /api/webhooks/twilio/a2p-status`

Handles Twilio Event Streams or Messaging/Trust Hub status callbacks:

- `brand_registration.approved` / `.failed`
- `campaign_registration.approved` / `.failed`
- Sole prop OTP-related status transitions

Maps `account_sid` → `organizations.twilio_subaccount_sid` → updates `org_sms_compliance` row. On full approval: attach campaign to existing Messaging Service, set `status = active`.

Rate-limited; Twilio signature verified (subaccount auth token from `organization_twilio_secrets`).

---

## Status state machine

```
not_started
    → pending_profile      (Trust Hub bundle submitted)
    → pending_brand        (BrandRegistration created)
    → pending_otp          (sole prop only — waiting for user YES on TCR SMS)
    → pending_campaign     (Campaign submitted)
    → active               (Campaign verified; number linked)
    → failed               (terminal; retry allowed)
    → upgrading            (sole prop active + standard registration in flight)
    → active               (upgrade cutover complete)
```

| `status` | Outbound SMS | Inbound SMS | Voice |
|----------|--------------|-------------|-------|
| `not_started` / `pending_*` | Blocked (task fails with `sms_compliance_inactive`) | Allowed | Allowed |
| `active` | Allowed | Allowed | Allowed |
| `failed` | Blocked | Allowed | Allowed |
| `upgrading` | Allowed on sole prop campaign | Allowed | Allowed |

**Enforcement points:**

1. `TaskExecutionWorkflow` / `activities/channels.py` — before `send_sms()`, load compliance status; fail task with structured `guardrail_result` if not `active`.
2. Optional: `decision/guardrails.py` precondition `sms_compliance_active` for proactive outbound (future first-touch).

Inbound replies do not require A2P campaign for the *inbound* leg; blocking outbound until registered matches carrier rules for ISV subaccounts.

---

## Data model

New table `organization_sms_compliance` (service-role writes; admin read via API):

```sql
create table organization_sms_compliance (
  org_id                    uuid primary key references organizations (id) on delete cascade,
  lane                      text not null check (lane in ('sole_proprietor', 'standard')),
  status                    text not null,
  brand_registration_sid    text,
  campaign_sid              text,
  customer_profile_sid      text,
  trust_product_sid         text,
  failure_code              text,
  failure_message           text,
  submitted_at              timestamptz not null default now(),
  activated_at              timestamptz,
  -- upgrade tracking
  upgrade_lane              text,
  upgrade_status              text,
  upgrade_brand_registration_sid text,
  upgrade_campaign_sid      text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
```

RLS: `SELECT` for org admins (`is_org_admin`); mutations only via service-role in API handlers (same pattern as Twilio secrets).

Store **no** EIN, SSN, or raw mobile OTP data in logs. Persist only Twilio SIDs + status; PII fields exist only in the POST body transit to Twilio (consider not persisting EIN at rest, or encrypt if needed for upgrade retries).

---

## Twilio API implementation (`twilio_client.py`)

New module section or `twilio_compliance.py` sibling:

### Shared prerequisites (once per parent account, Console)

- Primary Customer Profile (Business) approved for Mirenta ISV.
- Policy SIDs stored in config: `TWILIO_A2P_POLICY_SID`, `TWILIO_TRUST_PRODUCT_POLICY_SID` (env vars).

### Per-org sequence (subaccount client)

**Sole Proprietor** ([ISV Sole Prop walkthrough](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api-sole-prop-new)):

1. `trusthub.v1.customer_profiles.create` (Starter Customer Profile)
2. Create `EndUser` (sole proprietor type) + `SupportingDocument` (address)
3. `customer_profiles.entity_assignments` + `customer_profiles.evaluations` → submit
4. `messaging.v1.brand_registrations.create` (`brand_type: SOLE_PROPRIETOR`)
5. **Wait** for OTP / `brand_registration.approved` webhook
6. `messaging.v1.services(campaigns).create` with Mirenta-fixed use case + samples
7. Link existing `organizations.twilio_messaging_service_sid` to campaign
8. `customer_profiles.channel_endpoint_assignment` — assign `twilio_phone_sid`

**Standard / Low-Volume Standard** ([ISV Standard API](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api-standard)):

1. Secondary Customer Profile (Business) + EndUser + SupportingDocuments
2. Trust Product for A2P messaging
3. `brand_registrations.create` (`STANDARD` or `LOW_VOLUME_STANDARD`)
4. Await brand approval (often minutes)
5. Campaign create with business-specific message flow (website URL, opt-in proof links)
6. Link Messaging Service + phone number

All calls use `get_twilio_client(account_sid=subaccount_sid, auth_token=decrypted_token)`.

### Platform-owned campaign copy

Because Mirenta controls the AI agent, hardcode vetted strings server-side:

| Field | Sole prop value (example) |
|-------|---------------------------|
| `description` | Conversational customer care follow-up after phone contact |
| `message_samples` | `Hi {name}, this is {agent} following up from our call. Reply STOP to opt out.` |
| `opt_in_message` | Verbal consent during inbound/outbound call before SMS follow-up |
| `opt_out_message` | Reply STOP to unsubscribe |
| `help_message` | Reply HELP for assistance |
| `message_flow` | 40–2049 char template referencing voice consent + privacy policy URL |

Standard lane may require org-specific `website_url` and opt-in screenshot links in `message_flow` — API can accept optional `opt_in_proof_url` for campaign submission.

---

## Upgrade path (sole prop → standard)

1. Org calls `POST .../sms-compliance/upgrade` with standard fields.
2. Set `upgrade_status = pending_*`; sole prop campaign **stays live**.
3. Register new Standard brand + campaign in parallel (new SIDs in upgrade columns).
4. On `upgrade` campaign `VERIFIED` webhook:
   - Remove phone number from sole prop Messaging Service campaign association
   - Attach to new standard campaign / same Messaging Service
   - Set `lane = standard`, `upgrade_status = completed`, delete/archive sole prop campaign via API
5. Update `limits` exposed in GET response (MPS, daily cap, multi-number).

No in-place "toggle" — TCR treats brand types as distinct legal entities.

---

## UX flow (dashboard)

### Sole proprietor — "Enable texting in minutes"

1. **Step 1 — Form:** Personal name, address, mobile, email. Copy explains: "Use your legal name, not your business LLC name."
2. **Step 2 — OTP:** "Check your phone for a text from The Campaign Registry. Reply YES within 24 hours."
3. **Step 3 — Polling / webhook-driven UI:** Show `pending_otp` → `pending_campaign` → `active`.
4. **Limits banner:** 1 number, 3k segments/day, 1 MPS — link to upgrade.

### Standard — "Register your business"

1. **Form:** EIN, legal name, website, authorized rep.
2. **Expectations:** "Brand approval: ~minutes. Campaign approval: 3–15 business days."
3. **Status:** Email optional when `active`.

### Org creation

Keep existing auto-provision (phone + voice + inbound SMS). Add onboarding checklist item: **"Complete SMS registration"** with lane picker — do **not** block org creation on compliance.

---

## Configuration (new env vars)

| Variable | Description |
|----------|-------------|
| `TWILIO_A2P_POLICY_SID` | Trust Hub US A2P 10DLC policy |
| `TWILIO_A2P_TRUST_PRODUCT_POLICY_SID` | A2P Trust Product policy |
| `TWILIO_A2P_STATUS_CALLBACK_URL` | Defaults to `{APP_BASE_URL}{API_PREFIX}/webhooks/twilio/a2p-status` |
| `MIRENTA_PRIVACY_POLICY_URL` | Injected into campaign message_flow |
| `MIRENTA_TERMS_URL` | Injected into campaign message_flow |

---

## Implementation phases

### Phase 1 — Sole proprietor lane (MVP)

- [ ] Migration `organization_sms_compliance`
- [ ] `register_sole_proprietor_compliance()` in Twilio client
- [ ] `POST/GET .../sms-compliance` (sole prop only)
- [ ] A2P status webhook + state updates
- [ ] Outbound SMS gate in `activities/channels.py`
- [ ] Tests with mocked Twilio REST

**Outcome:** Individual users can self-serve SMS in hours.

### Phase 2 — Standard lane

- [ ] `register_standard_compliance()`
- [ ] Extended POST body + campaign message_flow builder
- [ ] Longer-running status polling fallback if webhooks missed

**Outcome:** LLCs and registered businesses onboard correctly.

### Phase 3 — Upgrade + ops

- [ ] `POST .../sms-compliance/upgrade`
- [ ] Cutover logic + sole prop teardown
- [ ] Admin re-provision / retry endpoints
- [ ] Metrics: `sms_compliance_submitted`, `sms_compliance_activated`, `sms_compliance_failed`

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| User registers LLC as sole prop (TCR error 30915) | API name validation + UI copy; map Twilio errors to `failure_message` |
| OTP never completed | `pending_otp` expires after 24h → `failed` with retry |
| Campaign rejection (message flow) | Pre-vetted templates; standard lane accepts `opt_in_proof_url` |
| Bad actor spam on platform | Keep per-org brands (not umbrella); existing output_guardrails + decision guardrails |
| Twin campaign fees during upgrade | Document in UI; delete sole prop after cutover |
| Webhook misses | Temporal scheduled activity: poll brand/campaign status every 15m while `pending_*` |

---

## Open questions

1. **Persist registration PII?** Recommend: no EIN/mobile at rest; re-collect on retry/upgrade.
2. **Re-provision endpoint?** If org creation Twilio step failed, separate `POST .../twilio/reprovision` may be needed before compliance.
3. **Toll-free lane?** Separate proposal if product wants 833/888 instant messaging track.
4. **Pricing passthrough?** TCR brand/campaign monthly fees — bill org or absorb?

---

## Summary

Add `POST /organizations/{org_id}/sms-compliance` with `lane: sole_proprietor | standard`, automate Trust Hub + Brand + Campaign in the **existing per-org subaccount**, track state in `organization_sms_compliance`, and gate outbound SMS until `active`. Sole prop gives Beside-like fast onboarding (with mandatory user OTP); standard gives correct path for LLCs/EINs; upgrade API bridges growth without downtime.
