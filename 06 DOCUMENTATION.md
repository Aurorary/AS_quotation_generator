# WORQ Quotation Generator — Project Documentation

## Overview

Automates the WORQ KL quotation workflow on Google Apps Script (clasp-managed). Two parallel UIs share the same backend:

- **In-sheet sidebar** — modal dialog opened from the Tracker spreadsheet menu, original entry point.
- **Standalone web app** — full-page UI at `script.google.com/.../exec`, intended for daily use including mobile, supports drafts, approvals, customer autocomplete, status lifecycle, and a daily follow-up digest.

Both surfaces produce identical PDFs and write to the same tracker, so a quote can be drafted in either and acted on in either.

---

## Quick architecture

```
┌──────────────────┐    ┌──────────────────┐
│  In-sheet        │    │  Web app         │
│  modal sidebar   │    │  (doGet → 08)    │
│  (03 Sidebar)    │    │                  │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
       ┌─────────────────────────────┐
       │  Backend (.gs files)        │
       │  Sidebar.gs, PdfGenerator,  │
       │  DriveManager, PayloadStore,│
       │  DraftFlow, Reminders       │
       └────────────┬────────────────┘
                    ▼
       ┌─────────────────────────────┐
       │  Tracker spreadsheet        │
       │  ─ NEW COMBINED  (rows)     │
       │  ─ ADDRESS       (outlets)  │
       │  ─ _payloads     (hidden)   │
       └─────────────────────────────┘
```

---

## Tech stack

- **Google Apps Script** (V8 runtime), bound to the Tracker spreadsheet
- **clasp** for local development and `clasp push -f` deploys
- **HTML Service** for both UIs (sidebar modal + web app full page)
- **DriveApp** for HTML → PDF conversion and folder writes
- **GmailApp** for customer emails, draft notifications, rejection notes, follow-up digest
- **CacheService** for catalogue (10 min), logo (6 h), customer-history datalist (5 min), pending preview payload (10 min)
- **Time-driven trigger** for the daily 9am follow-up digest

---

## Resources

| Resource | ID | Notes |
|---|---|---|
| **Quotation Tracker** | `1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0` | Spreadsheet — `NEW COMBINED`, `ADDRESS`, hidden `_payloads` |
| **Price Catalogue** | `1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps` | Separate sheet, `Hardware & Services` tab |
| **WORQ logo** | `1e1WWzk00qzDRwA82uWOTYZFHjYidP5Q7` | Drive file, embedded as base64 in PDF |
| **Quotations folder** | `1HgsVQlCmjTOF8jn0l77iRq5_6ViCqHP5` | Drive folder for sent and draft PDFs |

All IDs are stored as Script Properties — nothing hardcoded.

### Script Properties

Run `setupScriptProperties()` once from the Apps Script editor.

| Key | Value |
|---|---|
| `TRACKER_SHEET_TAB` | `NEW COMBINED` |
| `ADDRESS_TAB_NAME` | `ADDRESS` |
| `CATALOGUE_SHEET_ID` | `1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps` |
| `CATALOGUE_TAB_NAME` | `Hardware & Services` |
| `QUOTATIONS_FOLDER_ID` | `1HgsVQlCmjTOF8jn0l77iRq5_6ViCqHP5` |
| `LOGO_FILE_ID` | `1e1WWzk00qzDRwA82uWOTYZFHjYidP5Q7` |

### OAuth scopes (manifest)

```
spreadsheets, drive, gmail.send, script.container.ui,
script.scriptapp, userinfo.email
```

`script.scriptapp` is needed by `setupDailyReminder` (it manages triggers). `userinfo.email` is needed by `Session.getActiveUser().getEmail()` for permission gating.

---

## File structure

```
03 QUOTATION GENERATOR/
├── appsscript.json          OAuth scopes, V8 runtime, Asia/Kuala_Lumpur tz
├── .clasp.json              clasp config (scriptId, parentId)
├── .claspignore             excludes README, this doc, node_modules
│
├── 01 Code.gs               doGet, onOpen, openSidebar, getNextQuoteNumber,
│                            getLocations, setupScriptProperties,
│                            APPROVER_EMAILS allowlist, isApprover
├── 02 Sidebar.gs            getInitialData, getCatalogueItems,
│                            previewQuotation, confirmQuotation,
│                            setQuoteStatus, markBilled,
│                            getRecentQuotes, getWebAppData, getNewQuoteData,
│                            appendTrackerRow / updateTrackerRow
├── 03 Sidebar.html          In-sheet modal UI
├── 04 PdfGenerator.gs       buildHtmlQuotation, convertHtmlToPdf,
│                            buildPdfFileName, getLogoBase64
├── 05 DriveManager.gs       savePdf
├── 06 DOCUMENTATION.md      this file
├── 07 quotation_template.html  PDF layout (HtmlTemplate)
├── 08 WebApp.html           Standalone full-page UI (landing, new quote,
│                            revise picker, review draft)
├── 09 PayloadStore.gs       Hidden _payloads tab manager: savePayload,
│                            upsertPayload, loadPayload, getQuoteHistory,
│                            getCustomerHistory, getCustomerProfile,
│                            getRevisionData, buildRevisionNumber
├── 10 DraftFlow.gs          saveDraftFromPending, approveAndSend,
│                            rejectDraft, getDraftsAwaitingApproval,
│                            getDraftForEdit, updateDraftFromPending,
│                            notifyApproversOfDraft
└── 11 Reminders.gs          setupDailyReminder, dailyFollowUpReminder,
                             findStalePendingCustomerQuotes
```

---

## Tracker sheet (`NEW COMBINED`)

| Col | Header | Source | Notes |
|---|---|---|---|
| A | Date | written | Quote date |
| B | Quote # | written | `WORQ/ITG/2026/10` (new) or `… rev1` (revision) |
| C | Customer | written | Company name |
| D | Work | written | Description |
| E | Remark | manual | Internal notes (not touched by code) |
| F | Document Link | written | Drive PDF URL |
| G | Quoted Price | written | Gross to customer |
| H | Cost Price | written | Internal |
| I | Profit | written | G − H |
| J | Margin | written | I / G as % |
| K | Status | written + dropdown | `Draft / Pending Customer / Pending Bill / Billed / Cancelled` |
| L | Remark | manual | Free-text — historically held invoice numbers, now use M |
| M | Invoice number | written by `markBilled` | Format `C-{digits}-{digits}` |
| N | Drafted by | written by `saveDraft` | Email of the team member who drafted |
| O | Rejection note | written by `rejectDraft` | Free-text reason from approver |

Every quotation always **appends** a new row. Drafts are mutated in place during the edit-draft flow but never removed; rejection sets status `Cancelled` and writes column O. Approval flips status from `Draft` to `Pending Customer` on the same row.

---

## ADDRESS tab

Columns: A=Outlet Code, B=Full Address (multi-line), C=Outlet Email, D=Account No.

Fetched at runtime — update the sheet, no code changes needed. Account number from D appears in the PDF payment details. Line 1 of B is the location name; line 2 is the company name; rest is the postal address.

---

## Hidden `_payloads` tab

Storage layer for revisions and customer autocomplete. Created automatically on first write.

Columns: A=quoteNumber, B=parentQuoteNumber, C=timestamp, D=payloadJson.

- `savePayload` appends one row per sent quote (full payload JSON)
- `upsertPayload` is used by drafts so editing replaces the row in place
- `loadPayload(quoteNumber)` returns the most recent row matching that quote number (case-sensitive)
- `getQuoteHistory(limit)` joins payloads with tracker metadata for the Revise picker
- `getCustomerHistory()` returns a deduped list of past customer names (datalist source)
- `getCustomerProfile(name)` returns all distinct values per contact field (email/CC/address) seen for that customer, newest first

The tab stays hidden in normal use; right-click → Show all sheets if you need to inspect.

---

## Price catalogue (`Hardware & Services`)

Columns: A=Category | B=Brand | C=Item Description | D=Cost/Unit | E=Cost Price | F=Price | G=Charge Type | H=Remark.

**Row classification:**
- Non-empty **Category (A)** = parent row, starts a new item group
- Blank A, non-empty **Brand (B)** = sibling item under the same category, OR a secondary billing component if it has a different charge type from the parent
- Blank A and B, non-empty C = sub-component of the previous item
- Blank A and B, all empty = spacer (filtered out)

**Selling price:**
- If F is set → used directly
- Otherwise computed from E using 30% markup: `roundup(Cost / 0.7, -2)` (round up to nearest 10)

**Custom items:** two special rows at the end of the catalogue (`One-off Custom Item`, `Monthly Custom Item`). When added, the description and cost price become editable inline.

After updating the catalogue → `Quotation Generator → Clear Cache` from the menu.

---

## Quote number logic

Format `WORQ/{LOCATION}/{YEAR}/{N}`, plus optional ` rev{n}` suffix.

```
WORQ/ITG/2026/10
WORQ/TTDI/2026/11        ← shared running counter across locations
WORQ/ITG/2026/11 rev1    ← revision (lowercase, space-rev-N)
WORQ/ITG/2026/11 rev2    ← later revision
```

The running counter scans column B for the highest trailing number across all locations for the current year, then increments. Revisions never bump the counter — they reuse the parent number with a rev suffix and append a new tracker row.

---

## In-sheet sidebar workflow

1. Open the tracker spreadsheet → menu `Quotation Generator → Generate Quotation`
2. Modal dialog (1000×750):
   - Pick location, customer details, work
   - Search catalogue, add items, adjust qty / unit price
   - Optionally tick "Is this a revision?" and edit the rev number
3. Click **Generate Quotation**
   - Server builds HTML, returns it; preview renders inside the dialog iframe
   - Pending payload cached for 10 min
4. Click **Confirm & Send**
   - PDF generated, saved to Drive folder
   - Email sent to customer (PDF attached); CC included if provided
   - Tracker row appended with status `Pending Customer`
   - Payload upserted to `_payloads`

---

## Web app workflow

URL is the deployment's `/exec` URL. Access is `Anyone within worq.space`. Execute as the script owner.

### Landing dashboard

- **+ New Quote** card — fresh quotation, threshold-aware send/draft buttons
- **↻ Revise Quote** card — picker over past quotes (excludes Draft and Billed)
- **Drafts awaiting your approval** — visible only when 1+ drafts exist; approvers see all drafts, drafters see only their own
- **Recent quotes** — last 30 days, hides `Billed` and `Cancelled` rows (worklist mode)

### Recent quotes row controls

Each row has `[PDF] [⋯]` plus, on `Pending Bill` rows, a fast-path `[+ Invoice #]`. The `⋯` menu offers mark-as-X actions for every status that isn't current. `Mark Billed` always prompts for an invoice number (regex `^C-\d+-\d+$`) and writes column M atomically with status K.

### New Quote view

- Customer name field uses an HTML `<datalist>` populated from `getCustomerHistory`
- Picking a known customer triggers `getCustomerProfile`:
  - Single historical value per field → autofill it (and remember the autofill so a later customer change can replace it without clobbering hand-typed values)
  - Multiple distinct values → show clickable hint pills under the field; click to fill
- Margin row appears under Quoted Total once both quoted and cost are non-zero; orange `LOW MARGIN` chip when margin < 20% (soft warning, doesn't block)

### Preview panel

- `← Back & Edit` (always present)
- `Save as Draft` (always available)
- `Send Now` — hidden when:
  - Current user is non-approver and gross ≥ RM 10,000, or
  - This is a revision (revisions always go through approval)
  - In both cases, an explanatory yellow notice appears

`confirmQuotation` re-checks the threshold server-side so the rule can't be bypassed by editing the page.

### Revise picker

Searchable list of past quotes (excludes Draft and Billed; Cancelled stays so a rejected proposal can be revived). Click `Revise →` to load the New Quote form with everything pre-filled and the quote number bumped (`… rev1` → `… rev2`). Cross-payload backfill: any contact field empty in the original payload is filled from the customer's other quotes when there's exactly one historical value, or surfaced as hints if multiple.

### Review Draft view (approvers)

Approvers click `Review →` on a draft row → split-pane with the draft PDF embedded via Drive's `/preview` URL and three actions:

- **Reject with note** — prompts for reason → status `Cancelled`, note in column O, drafter emailed
- **Edit** — loads the form prefilled (banner says "Editing draft … (drafted by …)"), buttons become `Update Draft` / `Approve & Send`
- **Approve & Send** — atomic: re-renders PDF without the `[DRAFT]` prefix, sends to customer, flips draft row to `Pending Customer`, trashes the draft PDF

Non-approvers clicking `Edit →` on their own draft skip the review view and go straight into the editable form; they see only `Update Draft` (no send).

### Approval threshold

```js
APPROVER_EMAILS         = ['afdhal@worq.space']     // 01 Code.gs
APPROVAL_THRESHOLD_MYR  = 10000
```

Rules:

| Who | Quote amount | Direct send | Save draft |
|---|---|---|---|
| Approver | any | ✅ | ✅ |
| Team member | < RM 10K | ✅ | ✅ |
| Team member | ≥ RM 10K | ❌ | ✅ |
| Anyone | revising | ❌ | ✅ |

Drafts always notify all approvers via email. Approval is atomic — clicking Approve & Send fires the same send flow as a direct send, using the saved payload snapshot.

---

## PDF layout

Same template, with a `[DRAFT] ` filename prefix while in draft state. The prefix is dropped when the draft is approved and a fresh PDF is generated.

Filename format: `WORQ-{LOCATION}-{YEAR}-{N} ({Customer Name}).pdf`

- Slashes in the quote number become hyphens
- Customer name has filename-illegal chars stripped (`\ / : * ? " < > |`)
- Customer name is omitted if blank

Existing PDFs are inherited from the parent folder's sharing settings — `setSharing` is intentionally not called (it fails when the executing identity isn't the file owner).

---

## Daily follow-up reminder

`11 Reminders.gs` installs a time-driven trigger via `setupDailyReminder`:

- Fires daily at 9am Asia/Kuala_Lumpur
- Scans tracker for `Pending Customer` rows older than 7 days
- Sends a single digest email to `afdhal@worq.space` listing the stale quotes (oldest first), with quote number, customer, days-old, amount, and Drive link
- Sends nothing if zero stale quotes (no noise)

To install or reinstall: open `11 Reminders.gs` in the editor, select `setupDailyReminder` from the function dropdown, click Run, authorise the prompt. Re-running deletes any prior trigger first, so it's idempotent.

To test ad-hoc: run `testDailyReminderNow` from the editor.

---

## Email behaviour

The quotation generator no longer auto-emails the customer. Per team feedback, quotations are usually attached to an existing email thread with the customer, so generating a new outbound thread was unwanted. Instead, clicking **Generate** (or **Approve** on a draft) renders the PDF, saves it to Drive, writes the tracker row, and returns the Drive link in the success toast — the team forwards/attaches it themselves. The customer email and CC fields have been removed from the form.

The remaining automated emails are all internal/operational:

| Scenario | To | CC | Body |
|---|---|---|---|
| Approval-needed notification | every email in `APPROVER_EMAILS` | — | Quote#, customer, amount, drafter, link to dashboard |
| Draft rejected | drafter (column N) | — | Approver's note |
| Daily follow-up digest | `afdhal@worq.space` | — | Bulleted list of stale quotes |

---

## Permissions and identity

- Web app deploys as the script owner (`it_worq@worq.space`); `Session.getActiveUser().getEmail()` resolves to the *viewing* user thanks to `userinfo.email` scope
- Approver allowlist is checked server-side in `approveAndSend`, `rejectDraft`, and `confirmQuotation` (≥ RM 10K rule). Frontend gating mirrors these rules but is not the source of truth.
- Drive folder is in a shared workspace folder; all WORQ accounts inherit access. The script never calls `setSharing` because the executing identity isn't always the folder owner.

---

## Setup checklist

- [ ] `npm install -g @google/clasp` and `clasp login`
- [ ] Apps Script API enabled at script.google.com/home/usersettings
- [ ] `.clasp.json` has correct `scriptId` and `parentId`
- [ ] Run `setupScriptProperties()` from the editor
- [ ] Run `setupDailyReminder()` from `11 Reminders.gs` (one time, will prompt for new scopes)
- [ ] In Apps Script editor → **Deploy → New deployment** → type Web app, execute as Me, access "Anyone within worq.space" → copy `/exec` URL
- [ ] Tracker sheet has columns M (Invoice number), N (Drafted by), O (Rejection note) headers added
- [ ] Column K dropdown contains: `Draft / Pending Customer / Pending Bill / Billed / Cancelled`
- [ ] Sidebar smoke test: menu opens modal, end-to-end send works
- [ ] Web app smoke test: dashboard loads, drafts, autocomplete, revise, status menu, invoice prompt all reachable
- [ ] Email digest test: run `testDailyReminderNow` after creating a >7-day stale `Pending Customer` row (or temporarily lower `REMINDER_AGE_DAYS` to 0)

---

## clasp dev workflow

```bash
# Daily
clasp push --force         # push local edits
clasp open                 # open editor in browser
clasp logs                 # Stackdriver tail for debugging
```

Web app deployments are versioned. `clasp push` only updates the source — to ship a new version to users, **Deploy → Manage deployments → ✏ on active deployment → "New version" → Deploy**, or use the `/dev` URL during development (always serves latest pushed source).

---

## Phase log

The current capability set was built in four phases on top of the original sidebar tool:

- **Phase A** — web app shell, full-page landing dashboard, New Quote view ported from sidebar
- **Phase C** — `_payloads` tab, Revise picker, full payload restoration into the form
- **Phase B** — customer autocomplete with single-value autofill and multi-value clickable hints, applied to both new and revise flows
- **Phase D**
  - D1: status row menu, `Yes` → `Billed` rename, invoice-gated `Mark Billed`
  - D2: draft → approval → send/reject pipeline with RM 10K threshold
  - D3: inline `+ Invoice #` fast-path on `Pending Bill` rows, column-mapping fix
  - D4: daily 9am follow-up digest, margin guardrail at 20%, dashboard / revise status filters

The in-sheet sidebar continues to work alongside the web app for any flow you prefer to keep "inside" the spreadsheet.
