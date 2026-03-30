# WORQ Quotation Generator — Project Documentation

## Overview

Automate the WORQ KL quotation workflow using Google Apps Script (clasp-managed). A modal dialog in the Tracker Google Sheet lets the team pick items from the product catalogue, input customer details, auto-assign a quote number, preview the quotation, then confirm — which generates a PDF saved to Drive, emails it to the customer, and logs everything back to the tracker.

---

## Architecture

| File | Purpose |
|---|---|
| **Quotation Tracker** | Management view — one row per quote, script is bound here |
| **Price Catalogue** | Separate sheet — hardware & services items, cost prices, selling prices |
| **ADDRESS tab** | Moved into the Tracker sheet — outlet codes, addresses, emails, account numbers |

---

## Tech Stack

- **Google Apps Script** (bound to Tracker spreadsheet)
- **clasp** — local development and push
- **HTML Service** — modal dialog UI (1000×750px, opens inside Google Sheets)
- **DriveApp** — HTML → PDF conversion + file storage
- **GmailApp** — send PDF to customer
- **CacheService** — catalogue cached 10 min, logo cached 6 hours

---

## Google Sheets Resources

| Resource | Spreadsheet ID | Tab |
|---|---|---|
| **Quotation Tracker** | `1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0` | `NEW COMBINED` |
| **Address / Locations** | `1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0` | `ADDRESS` (same as tracker) |
| **Price Catalogue** | `1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps` | `Hardware & Services` |

## Other Resources

| Resource | ID |
|---|---|
| **WORQ Logo (Google Drive file)** | `1e1WWzk00qzDRwA82uWOTYZFHjYidP5Q7` |
| **Quotations Drive Folder** | `1HgsVQlCmjTOF8jn0l77iRq5_6ViCqHP5` |

> All IDs are stored as **Script Properties** in Apps Script — nothing hardcoded in code files.

---

## Script Properties (set once via `setupScriptProperties`)

| Key | Value |
|---|---|
| `TRACKER_SHEET_TAB` | `NEW COMBINED` |
| `ADDRESS_TAB_NAME` | `ADDRESS` |
| `CATALOGUE_SHEET_ID` | `1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps` |
| `CATALOGUE_TAB_NAME` | `Hardware & Services` |
| `QUOTATIONS_FOLDER_ID` | `1HgsVQlCmjTOF8jn0l77iRq5_6ViCqHP5` |
| `LOGO_FILE_ID` | `1e1WWzk00qzDRwA82uWOTYZFHjYidP5Q7` |

Run `setupScriptProperties()` from the Apps Script editor once to set all values. Re-run anytime to reset.

---

## Tracker Sheet Structure (`NEW COMBINED` tab)

| Col | Header | Notes |
|---|---|---|
| A | Date | Quote date |
| B | Quote # | Format: `WORQ/ITG/2026/10` — script auto-generates |
| C | Customer | Customer company name |
| D | Work | Description of work |
| E | Remark | Internal notes |
| F | Document Link | Drive PDF link — written back by script |
| G | Quoted Price | Written back by script |
| H | Cost Price | Written back by script (internal only) |
| I | Profit | Written back by script (G - H) |
| J | Margin | Written back by script (I / G as %) |
| K | Billed? | Dropdown: Yes / Pending Customer / Pending Bill / Cancelled — default: Pending Customer |

Every quotation (new or revision) always appends a **new row**. Revisions are identified by the Rev suffix in the quote number.

---

## ADDRESS Tab Structure (in Tracker sheet)

**Columns:** A = Outlet Code | B = Full Address (multi-line) | C = Outlet Email | D = Account No

Fetched **dynamically at runtime** — update the sheet, no code changes needed.

Account number from col D is used in the PDF payment details section per outlet.

---

## Price Catalogue Structure (`Hardware & Services` tab)

**Columns:** A=Category | B=Brand | C=Item Description | D=Cost/Unit | E=Cost Price | F=Price | G=Charge Type | H=Remark

**Key rules:**
- Row with **non-empty Category (A)** = start of new item group (parent row)
- Row with **blank Category but non-empty Brand (B)** = new item inheriting the last category (e.g. Power Calculation under Rack Space)
- Rows with **blank Category and blank Brand** = sub-components of the previous item (Cost/Unit in col D)
- **Cost Price (E)** and **Price (F)** on the parent row = totals used for billing
- If col F (Price) is set, it is used directly as the selling price
- If col F is blank/zero, selling price is computed from Cost Price using 30% markup: `roundup(Cost / 0.7, -2)`
- **Charge Type (G)** on sub-component rows is stored and shown as a label tag in the PDF

**Selling price formula (30% markup default):**

| Markup % | Formula |
|---|---|
| **30% (default)** | `roundup(Cost / 0.7, -2)` |

Prices are rounded up to the nearest 100. Items with a fixed catalogue price (col F) are NOT affected by markup.

**Custom Items:**
- Two special rows at the bottom of the catalogue: `Custom Item — One-off Custom Item` and `Custom Item — Monthly Custom Item`
- When added, the description field becomes editable inline in the sidebar
- Unit price defaults to 0 and must be entered manually; cost price is tracked as 0

**After updating the catalogue sheet, always run Clear Cache** from the Quotation Generator menu.

---

## Quote Number Logic

**Format:** `WORQ/{LOCATION}/{YEAR}/{RUNNING_NUMBER}`

**Examples:**
```
WORQ/ITG/2026/10
WORQ/TTDI/2026/11   ← same running sequence, different location
WORQ/ITG/2026/11 rev1  ← revision
WORQ/ITG/2026/11 rev2  ← second revision
```

**Auto-generation:**
1. Script scans Column B of tracker for all existing quote numbers
2. Extracts the highest trailing number across ALL locations for the current year
3. Increments by 1
4. Prepends selected location code + current year

**Revisions:**
- User checks "Is this a revision?" in sidebar
- Quote number becomes editable, pre-filled with existing number + ` rev1`
- Script auto-detects existing rev suffix and increments: `rev1` → `rev2`
- Revision does NOT increment the running number counter
- Revision always appends a new row in the tracker

---

## Project File Structure

```
03 QUOTATION GENERATOR/
├── appsscript.json          ← OAuth scopes, timezone (Asia/Kuala_Lumpur), V8 runtime
├── .clasp.json              ← clasp config (scriptId, parentId)
├── .claspignore             ← excludes README, DOCUMENTATION.md, node_modules
├── Code.gs                  ← onOpen, menu, openSidebar, getLocations, getNextQuoteNumber, clearCache, setupScriptProperties, debugLocations
├── Sidebar.gs               ← getInitialData, getCatalogueItems, previewQuotation, confirmQuotation, sendEmail, updateTrackerRow
├── PdfGenerator.gs          ← buildHtmlQuotation, convertHtmlToPdf, getLogoBase64, chargeTag
├── DriveManager.gs          ← savePdf
├── sidebar.html             ← Modal dialog UI (vanilla JS, inline CSS)
└── quotation-template.html  ← PDF layout (HtmlTemplate scriptlets)
```

---

## Quotation Flow (Preview → Confirm)

```
1. Open Quotation Tracker sheet
2. Click "Quotation Generator > Generate Quotation"
3. Modal dialog opens (1000×750px):
   - Fill location, customer details, work description
   - Fill customer email and optional CC email
   - Search and add items from catalogue
   - Adjust qty / unit price as needed

4. Click "Generate Quotation"
   → Server builds HTML preview (no PDF yet)
   → Preview rendered in iframe inside the dialog

5. Review the quotation:
   - Click "← Back & Edit" to go back and make changes
   - Click "Confirm & Send" to finalise

6. On confirm:
   - PDF generated and saved to Drive folder
   - Email sent to customer (with PDF attachment); CC address included if provided
   - Outlet email sent separately
   - New row appended to tracker with all details
   - Success message with link to PDF
```

---

## Sidebar Features

### Catalogue Search & Add
- Search box filters catalogue by category, brand, or description in real time
- Catalogue list shows `[Category] Brand — Description`
- Selecting an item and clicking `+ Add Item` adds it to the items table
- **Bug fix:** filtered catalogue uses original index into `allCatalogueItems` — adding a filtered item always adds the correct item regardless of filter position

### Items Table
Columns: Description | Cat | Type | Qty | Unit Price | Total | (remove)

- **Type column** shows the item's charge type (Monthly in blue, One-Off in grey)
- **Custom items** render the description as an editable text input
- Qty and Unit Price are editable inline; totals recalculate on change

### Charge-Type Totals
- Sidebar shows a grouped breakdown (Monthly / One-Off) above the Cost/Quoted totals
- Breakdown is hidden when all items share the same charge type
- Bundle items with no top-level charge type (e.g. Unifi) do not appear in the breakdown

### Email Fields
- **Email** — primary recipient, PDF attached
- **CC Email (optional)** — added as CC on the customer email only

---

## PDF Layout

```
┌──────────────────────────────────────────────────────┐
│ [WORQ Logo]              WORQ Intermark               │
│                          WORQ KL SDN BHD              │
│                          Suite 09-01, Level 9..       │
│                          integra@worq.space           │
├──────────────────────────────────────────────────────┤
│ Quotation                Quotation Date               │
│                          27 Mar 2026                  │
│ Customer Name                                         │
│ Customer Address         Quotation Number             │
│                          WORQ/ITG/2026/11             │
├──────────────────────────────────────────────────────┤
│ Description          │ Qty │ Unit Price (MYR) │ Amt  │
├──────────────────────┴─────┴─────────────────┴───────┤
│ Card Access  (category header)                        │
│ 1. Card Reader + PIN [One-Off]         1  4,700  4,700│
│    a) PROID30BM Reader                                │
│    b) Inbio Pro Plus Controller                       │
│                                                       │
│ Landline  (category header)                           │
│ 2. Unifi bundle                                       │
│    Unifi Landline Activation Fee  [One-Off]           │
│    Unifi Physical Landline        [Monthly]           │
│    Land line Cable Pull           [One-Off]           │
│                                    1    420    420    │
│                                                       │
│                        One-Off       MYR 4,840.00    │
│                        Monthly         MYR 300.00    │
│                        ──────────────────────────    │
│                        TOTAL         MYR 5,140.00    │
├──────────────────────────────────────────────────────┤
│ PAYMENT DETAILS                                       │
│ Bank: Malayan Banking Berhad (Maybank)               │
│ Account Name: Worq KL Sdn Bhd                        │
│ Account No: [dynamic from ADDRESS tab]               │
│ SWIFT: MBBEMYKL                                      │
│ Payment Reference: WORQ/ITG/2026/11                  │
├──────────────────────────────────────────────────────┤
│ Terms & Conditions                                    │
│ Warranty: 12 months (manufacturer)                   │
│ Validity: 30 days from quotation date                │
│ Payment Terms: 100% upon completion                  │
└──────────────────────────────────────────────────────┘
```

**Charge type tags:**
- Each line item shows a coloured pill tag: `[One-Off]` (grey) or `[Monthly]` (blue)
- For bundle items (blank parent chargeType), tags appear on each sub-row individually
- Tags are rendered using inline `<table>` layout for reliable alignment in Google's PDF renderer

**Charge-group subtotals:**
- Shown between the last item row and the TOTAL row
- Only rendered when 2+ distinct charge types exist across top-level items
- Bundle items with blank parent chargeType are excluded from the subtotal split (totals remain correct)

**PDF Generation method:** HTML string → `DriveApp.createFile(blob)` → `.getAs('application/pdf')` → trash temp file → save PDF blob to Drive folder.

**Logo:** Fetched from Drive using `LOGO_FILE_ID`, converted to base64 data URI — ensures logo renders during Drive's HTML→PDF conversion. Cached 6 hours.

**Account Number:** Pulled dynamically from ADDRESS tab col D per outlet.

---

## Menu Options

| Menu Item | Function |
|---|---|
| Generate Quotation | Opens the 1000×750 modal dialog |
| Clear Cache | Clears catalogue and logo cache — **run after any catalogue sheet update** |

---

## Output Actions (on Confirm)

1. PDF saved to Drive folder → filename: `WORQ-ITG-2026-11.pdf`
2. New row appended to tracker with: Date, Quote#, Customer, Work, Doc Link, Quoted Price, Cost Price, Profit, Margin, Billed? (default: Pending Customer)
3. Row inherits dropdown validation and formatting from previous row
4. PDF emailed to customer (GmailApp, PDF as attachment); CC address added if provided
5. Outlet email sent separately (BCC-style internal copy)

---

## Clasp Dev Workflow

```bash
# One-time setup
git clone https://github.com/Aurorary/AS_quotation_generator.git
cd AS_quotation_generator

npm install -g @google/clasp
clasp login
# Enable Apps Script API first: script.google.com/home/usersettings

# Daily development
clasp push --force    # push local changes to Apps Script
clasp open            # open Apps Script editor in browser
clasp logs            # view Stackdriver logs for debugging
```

After each `clasp push --force`: reload the Tracker spreadsheet in browser to test changes.

---

## Setup Checklist

- [ ] `npm install -g @google/clasp` and `clasp login`
- [ ] Apps Script API enabled at script.google.com/home/usersettings
- [ ] `.clasp.json` has correct `scriptId` and `parentId` (Tracker spreadsheet ID)
- [ ] Run `setupScriptProperties()` from Apps Script editor
- [ ] Run `Quotation Generator > Clear Cache` after first setup
- [ ] **Test:** "Quotation Generator" menu appears after reload
- [ ] **Test:** Modal opens, location dropdown populated, quote number auto-generates
- [ ] **Test:** Catalogue loads, search filters work, item added from filtered list is correct
- [ ] **Test:** Charge type (Type column) shows correctly per item in sidebar
- [ ] **Test:** Charge-type grouped totals appear in sidebar when both types present
- [ ] **Test:** Custom item description is editable; price entered manually
- [ ] **Test:** CC email field passes through to sent email
- [ ] **Test:** Preview renders with charge type tags on item rows and sub-rows
- [ ] **Test:** PDF generates with correct location address, logo, grouped items, account number
- [ ] **Test:** Drive folder receives PDF file named correctly
- [ ] **Test:** Customer email received with PDF attached
- [ ] **Test:** Tracker row appended with all columns filled and dropdown validation intact
