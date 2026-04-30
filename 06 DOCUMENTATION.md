# WORQ Quotation Generator — Project Documentation

## Overview

Automates the WORQ KL quotation workflow on Google Apps Script (clasp-managed). The tool is **generate-only** — it renders the PDF, saves it to Drive, writes the tracker row, and surfaces a Drive link / Copy / Download chip on the success toast. The team forwards or attaches the PDF themselves into the existing customer email thread; nothing is auto-emailed to the customer or outlet. (See *Obsolete* at the bottom for the prior auto-email flow.)

Two parallel UIs share the same backend:

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
       │  DraftFlow, Reminders,      │
       │  CustomItemsLog, DocPdf     │
       └────────────┬────────────────┘
                    ▼
       ┌─────────────────────────────┐
       │  Tracker spreadsheet        │
       │  ─ NEW COMBINED   (rows)    │
       │  ─ ADDRESS        (outlets) │
       │  ─ _payloads      (hidden)  │
       │  ─ _custom_items  (hidden)  │
       └─────────────────────────────┘
```

---

## Tech stack

- **Google Apps Script** (V8 runtime), bound to the Tracker spreadsheet
- **clasp** for local development and `clasp push -f` deploys
- **HTML Service** for both UIs (sidebar modal + web app full page)
- **DocumentApp** for PDF rendering — a Google Docs template is copied per quote, placeholders are replaced, items table rows are injected, the doc is exported to PDF and the temp doc trashed (see [13 DocPdfRenderer.gs](13%20DocPdfRenderer.gs))
- **DriveApp** for the saved PDF, draft cleanup, and the `getPdfBlobAsBase64` endpoint that powers the Download chip
- **GmailApp** for the three remaining internal emails (draft notifications, rejection notes, follow-up digest) — there are no customer-facing emails
- **CacheService** for catalogue (10 min), logo (6 h), customer-history datalist (5 min), pending preview payload (10 min)
- **Time-driven trigger** for the daily 9am follow-up digest

---

## Resources

| Resource | ID | Notes |
|---|---|---|
| **Quotation Tracker** | `1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0` | Spreadsheet — `NEW COMBINED`, `ADDRESS`, hidden `_payloads` |
| **Price Catalogue** | `1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps` | Separate sheet, `Hardware & Services` tab |
| **WORQ logo** | `1e1WWzk00qzDRwA82uWOTYZFHjYidP5Q7` | Drive file, embedded as base64 in PDF |
| **Quotations folder** | `1HgsVQlCmjTOF8jn0l77iRq5_6ViCqHP5` | Drive folder for generated and draft PDFs |
| **PDF template Doc** | (set in Script Properties) | Google Doc copied per quote and exported to PDF |

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
| `PDF_TEMPLATE_DOC_ID` | (Doc id of the quotation template — see PDF rendering section) |

### OAuth scopes (manifest)

```
spreadsheets, drive, documents, gmail.send,
script.container.ui, script.scriptapp, userinfo.email
```

- `documents` powers the Doc-template-based PDF renderer
- `script.scriptapp` is needed by `setupDailyReminder` (it manages triggers)
- `userinfo.email` is needed by `Session.getActiveUser().getEmail()` for permission gating
- `gmail.send` is still required for the three internal emails (draft notification, rejection note, daily digest); no email goes to the customer

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
├── 04 PdfGenerator.gs       buildHtmlQuotation (preview only), getLogoBase64,
│                            buildPdfFileName, formatMyr
├── 05 DriveManager.gs       savePdf, getPdfBlobAsBase64 (Download chip)
├── 06 DOCUMENTATION.md      this file
├── 07 quotation_template.html  HTML used for the in-app preview iframe
├── 08 WebApp.html           Standalone full-page UI (landing, new quote,
│                            revise picker, review draft)
├── 09 PayloadStore.gs       Hidden _payloads tab manager: savePayload,
│                            upsertPayload, loadPayload, getQuoteHistory,
│                            getCustomerHistory, getCustomerProfile,
│                            getRevisionData, buildRevisionNumber
├── 10 DraftFlow.gs          saveDraftFromPending, approveAndSend,
│                            approveAndSendFromPending, rejectDraft,
│                            getDraftsAwaitingApproval, getDraftForEdit,
│                            updateDraftFromPending, notifyApproversOfDraft
├── 11 Reminders.gs          setupDailyReminder, dailyFollowUpReminder,
│                            findStalePendingCustomerQuotes
├── 12 CustomItemsLog.gs     Hidden _custom_items tab — appends rows when
│                            a custom-priced item is used at status
│                            Pending Customer / Pending Bill / Billed
└── 13 DocPdfRenderer.gs     renderPdfViaDoc — copies the PDF template Doc,
                             fills placeholders + items table, exports PDF,
                             trashes the temp Doc
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
- `getCustomerProfile(name)` returns all distinct values per contact field seen for that customer, newest first — currently only `customerAddress` (email/CC fields were removed when auto-emails were dropped)

The tab stays hidden in normal use; right-click → Show all sheets if you need to inspect.

### Hidden `_custom_items` tab

Audit log for one-off / monthly custom items. `12 CustomItemsLog.gs` appends a row whenever a custom-priced item appears in a quote whose status is `Pending Customer`, `Pending Bill`, or `Billed`. Drafts are intentionally not logged — the log is meant to capture items the team actually billed for, so the catalogue can be updated when the same custom item recurs.

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
   - Pick location, customer details (name, work, address — no email/CC fields)
   - Search catalogue, add items, adjust qty / unit price
   - Optionally tick "Is this a revision?" and edit the rev number
3. Click **Generate Quotation**
   - Server builds HTML, returns it; preview renders inside the dialog iframe
   - Pending payload cached for 10 min
4. Click **Generate**
   - PDF rendered via the Doc template, saved to the Drive folder
   - Tracker row appended with status `Pending Customer`
   - Payload saved to `_payloads`
   - **No email is sent** — copy the Drive link and attach the PDF into the existing customer thread yourself

---

## Web app workflow

URL is the deployment's `/exec` URL. Access is `Anyone within worq.space`. Execute as the script owner.

### Landing dashboard

- **+ New Quote** card — fresh quotation, threshold-aware Generate / Save Draft buttons
- **↻ Revise Quote** card — picker over past quotes (excludes Draft and Billed)
- **Drafts awaiting your approval** — visible only when 1+ drafts exist; approvers see all drafts, drafters see only their own
- **Open quotes** — worklist of `Pending Customer` and `Pending Bill` rows (hides `Billed` and `Cancelled`), oldest first, with age badges

### Open-quotes row controls

Each row has `[PDF] [copy] [↓] [⋯]` plus, on `Pending Bill` rows, a fast-path `[+ Invoice #]`.

- `PDF` — opens the Drive viewer in a new tab
- `copy` — copies the Drive link to the clipboard so it can be pasted into an email
- `↓` — calls `getPdfBlobAsBase64` and triggers a real browser download (drag-droppable into Gmail)
- `⋯` menu offers mark-as-X actions for every status that isn't current
- `Mark Billed` always prompts for an invoice number (regex `^C-\d+-\d+$`) and writes column M atomically with status K

### New Quote view

- Customer name field uses an HTML `<datalist>` populated from `getCustomerHistory`
- Picking a known customer triggers `getCustomerProfile`:
  - Single historical value for `customerAddress` → autofill it (and remember the autofill so a later customer change can replace it without clobbering hand-typed values)
  - Multiple distinct values → show clickable hint pills under the field; click to fill
- Margin row appears under Quoted Total once both quoted and cost are non-zero; orange `LOW MARGIN` chip when margin < 20% (soft warning, doesn't block)

### Preview panel

- `← Back & Edit` (always present)
- `Save as Draft` (always available)
- `Generate` — hidden when:
  - Current user is non-approver and gross ≥ RM 10,000, or
  - This is a revision (revisions always go through approval)
  - In both cases, an explanatory yellow notice appears

`confirmQuotation` re-checks the threshold server-side so the rule can't be bypassed by editing the page. Success toast shows `Open PDF · Copy link · Download` chips.

### Revise picker

Searchable list of past quotes (excludes Draft and Billed; Cancelled stays so a rejected proposal can be revived). Click `Revise →` to load the New Quote form with everything pre-filled and the quote number bumped (`… rev1` → `… rev2`). Cross-payload backfill: if the address is empty in the original payload it's filled from the customer's other quotes when there's exactly one historical value, or surfaced as hint pills if multiple.

### Review Draft view (approvers)

Approvers click `Review →` on a draft row → split-pane with the draft PDF embedded via Drive's `/preview` URL and three actions:

- **Reject with note** — prompts for reason → status `Cancelled`, note in column O, drafter emailed
- **Edit** — loads the form prefilled (banner says "Editing draft … (drafted by …)"), buttons become `Update Draft` / `Approve`
- **Approve** — atomic: re-renders the PDF without the `[DRAFT]` prefix, flips the draft row to `Pending Customer`, trashes the draft PDF. No customer email is sent — copy or download the PDF from the success toast and forward it yourself.

Non-approvers clicking `Edit →` on their own draft skip the review view and go straight into the editable form; they see only `Update Draft` (no Approve button). They can iterate on their draft any number of times until an approver acts on it. For amounts under RM 10K they can also skip the draft loop entirely and click Generate directly.

### Approval threshold

```js
APPROVER_EMAILS         = ['afdhal@worq.space']     // 01 Code.gs
APPROVAL_THRESHOLD_MYR  = 10000
```

Rules:

| Who | Quote amount | Generate directly | Save / update draft |
|---|---|---|---|
| Approver | any | ✅ | ✅ |
| Team member | < RM 10K | ✅ | ✅ |
| Team member | ≥ RM 10K | ❌ | ✅ |
| Anyone | revising | ❌ | ✅ |

Drafts always notify all approvers via email. Approval is atomic — clicking Approve renders the final PDF using the saved payload snapshot, replaces the `[DRAFT]` PDF in Drive, and flips the row to `Pending Customer`.

---

## PDF rendering

PDFs are rendered via a Google Docs template (`PDF_TEMPLATE_DOC_ID`), not HTML→PDF. `13 DocPdfRenderer.gs` does:

1. `DriveApp.makeCopy` of the template into the quotations folder
2. `DocumentApp.openById` on the copy
3. Replace simple text placeholders (`{{quoteDate}}`, `{{quoteNumber}}`, `{{customerName}}`, etc.)
4. Multi-line placeholders (`{{customerAddr}}`, `{{locationAddr}}`) are filled by capturing the host paragraph, replacing the marker with line 0, and inserting line 1..N as sibling paragraphs that copy alignment/text attributes
5. `fillItemsTable_` walks the items and injects rows into the template's items table — categories become bold underlined headers, sub-rows are letter-prefixed (skipping prefixing if the description already starts with `a)`), `[One-Off]` pills sit inline with the title
6. Export Doc → PDF blob → trash the temp Doc

Why a Doc template instead of an HtmlTemplate: Drive's HTML-to-PDF was visually inconsistent across runs and didn't honor styles reliably. A Doc gives WYSIWYG control — to change layout, edit the Doc.

A draft state adds a `[DRAFT] ` filename prefix; the prefix is dropped on approval when a fresh PDF is generated.

Filename format: `WORQ-{LOCATION}-{YEAR}-{N} ({Customer Name}).pdf`

- Slashes in the quote number become hyphens
- Customer name has filename-illegal chars stripped (`\ / : * ? " < > |`)
- Customer name is omitted if blank

Generated PDFs inherit sharing from the parent folder — `setSharing` is intentionally not called (it fails when the executing identity isn't the file owner).

`07 quotation_template.html` is still kept around as the in-app preview iframe source — it's *not* used for the saved PDF.

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
- [ ] Run `setupScriptProperties()` from the editor — make sure `PDF_TEMPLATE_DOC_ID` is set to a Doc you've prepared with the quotation layout
- [ ] Run `setupDailyReminder()` from `11 Reminders.gs` (one time, will prompt for new scopes)
- [ ] In Apps Script editor → **Deploy → New deployment** → type Web app, execute as Me, access "Anyone within worq.space" → copy `/exec` URL
- [ ] Tracker sheet has columns M (Invoice number), N (Drafted by), O (Rejection note) headers added
- [ ] Column K dropdown contains: `Draft / Pending Customer / Pending Bill / Billed / Cancelled`
- [ ] Sidebar smoke test: menu opens modal, end-to-end Generate works (PDF lands in Drive folder)
- [ ] Web app smoke test: dashboard loads, drafts, autocomplete, revise, status menu, invoice prompt, Copy link / Download chips all reachable
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

Post-phase changes:

- **Doc-template PDF renderer** — replaced flaky HTML→PDF with `13 DocPdfRenderer.gs`
- **Custom items log** — `12 CustomItemsLog.gs` records custom-priced items at meaningful status transitions
- **Generate-only mode** — auto-emails to customer and outlet removed; team forwards the PDF themselves. Customer email + CC fields removed from both UIs. `Send Now` → `Generate`, `Approve & Send` → `Approve`. Success toast and dashboard rows surface Copy link / Download chips for fast attaching into existing email threads.

The in-sheet sidebar continues to work alongside the web app for any flow you prefer to keep "inside" the spreadsheet.

---

## Obsolete

Older behaviors that have been removed. Kept here for context if you encounter older quotes / commits / docs that reference them.

### Auto-email send flow (removed)

Up until early 2026, clicking the equivalent of `Generate` (then called `Send Now` / `Confirm & Send` / `Approve & Send`) would:

- Email the customer at `payload.customerEmail` with the PDF attached, optionally CC'ing `payload.ccEmail`
- CC `it@worq.space` as an internal audit copy
- Email the outlet (`location.email`) a separate "internal copy" message with the Drive link in the body
- Validate `customerEmail` and `ccEmail` server-side via `isValidEmail` / `isValidCcList` before rendering the PDF

The form had **Email (for PDF delivery) \*** and **CC Email (optional)** fields, both required to reach a valid send. The `sendQuotationEmail(email, customerName, quoteNumber, pdfBlob, driveUrl, isCc, ccEmail)` helper in `02 Sidebar.gs` handled both customer and internal-copy bodies.

Why it was removed: the team usually had an existing email thread with the customer and wanted the quotation attached *inside* that thread, not as a fresh outbound message. The auto-send was creating duplicate threads and cluttering the team's inbox without adding value. After the change, the same workflow is one extra step (copy/download the PDF, paste into the existing thread), but the thread stays in the right place.

`isValidEmail`, `isValidCcList`, `EMAIL_PATTERN`, `sendQuotationEmail`, and the customer/CC fields and their datalist-hint plumbing are all gone from the codebase. `getCustomerProfile` no longer surfaces past emails — only past addresses.

### HTML→PDF rendering (replaced)

`04 PdfGenerator.gs` originally produced the saved PDF via `buildHtmlQuotation` + `convertHtmlToPdf` (Drive's HTML-to-PDF endpoint). Output quality was inconsistent — line wrapping, table cell sizing, and font rendering varied between runs. Replaced by the Doc-template renderer (see PDF rendering section). The HTML template is still used for the in-app preview iframe so users can see something approximating the final layout before they click Generate.

### Internal CC to `it@worq.space` (removed)

Was re-enabled briefly (commit `3cdd6b7`) as part of the auto-email flow, then removed entirely when generate-only mode landed.
