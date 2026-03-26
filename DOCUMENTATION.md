# WORQ Quotation Generator — Project Documentation

## Overview

Automate the WORQ KL quotation workflow using Google Apps Script (clasp-managed). A sidebar in the Tracker Google Sheet lets the team pick items from the product catalogue, input customer details, auto-assign a quote number, then generate a PDF — which is saved to Drive, emailed to the customer, and logged back in the tracker.

---

## Architecture Decision: Two Separate Sheets (Keep As-Is)

| File | Purpose |
|---|---|
| **Quotation Tracker** | Management view — one row per quote, filtered/sorted by team and management |
| **Quotation Template** | Holds individual quotation tabs + the ADDRESS config tab |

**Do NOT merge them.** Keeping them separate prevents the tracker from becoming bloated as quotation tabs accumulate over time. The Apps Script binds to the Tracker and writes document links back to the Template file.

---

## Tech Stack

- **Google Apps Script** (bound to Tracker spreadsheet)
- **clasp** — local development and push
- **HTML Service** — sidebar UI (opens inside Google Sheets)
- **DriveApp** — HTML → PDF conversion + file storage
- **GmailApp** — send PDF to customer

---

## Google Sheets Resources

| Resource | Spreadsheet ID | Tab |
|---|---|---|
| **Quotation Tracker** | `1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0` | `NEW COMBINED` |
| **Quotation Template** | `1a9ggAV7RN796FgFM9d5rQ-qIAGKAYGkDycK8l0CeKoY` | `QUOTATION TEMPLATE` |
| **Address / Locations** | `1a9ggAV7RN796FgFM9d5rQ-qIAGKAYGkDycK8l0CeKoY` | `ADDRESS` |
| **Price Catalogue** | `1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps` | `Hardware & Services` |

## Other Resources

| Resource | ID |
|---|---|
| **WORQ Logo (Google Drive file)** | `1e1WWzk00qzDRwA82uWOTYZFHjYidP5Q7` |
| **Quotations Drive Folder** | `1Zs1dTaiO7dy7tyCoHZpSNgrWDz5bK3Zw` |

> All IDs are stored as **Script Properties** in Apps Script — nothing hardcoded in code files.

---

## Script Properties (set once in Apps Script Project Settings)

| Key | Value |
|---|---|
| `TRACKER_SHEET_TAB` | `NEW COMBINED` |
| `TEMPLATE_SHEET_ID` | `1a9ggAV7RN796FgFM9d5rQ-qIAGKAYGkDycK8l0CeKoY` |
| `CATALOGUE_SHEET_ID` | `1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps` |
| `CATALOGUE_TAB_NAME` | `Hardware & Services` |
| `ADDRESS_SHEET_ID` | `1a9ggAV7RN796FgFM9d5rQ-qIAGKAYGkDycK8l0CeKoY` |
| `ADDRESS_TAB_NAME` | `ADDRESS` |
| `QUOTATIONS_FOLDER_ID` | `1Zs1dTaiO7dy7tyCoHZpSNgrWDz5bK3Zw` |
| `LOGO_FILE_ID` | `1e1WWzk00qzDRwA82uWOTYZFHjYidP5Q7` |

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
| I | Profit | Formula: G - H |
| J | Margin | Formula: I / G |
| K | Billed? | Dropdown: Yes / Pending Customer / Cancelled |

---

## Locations (ADDRESS tab of Template Sheet)

Fetched **dynamically at runtime** — team updates the sheet, no code changes needed.

**Columns:** A = Outlet Code | B = Full Address (multi-line) | C = Outlet Email

| Code | Location Name | Company |
|---|---|---|
| TTDI | WORQ TTDI | Incompleteness Theorem Sdn Bhd |
| UBP | WORQ Subang | Incompleteness Theorem Sdn Bhd |
| KLG | WORQ KL Gateway | Incompleteness Theorem Sdn Bhd |
| STO | WORQ Mutiara Damansara | Incompleteness Theorem Sdn Bhd |
| KLS | WORQ KL Sentral | WORQ KL Sdn Bhd |
| MUB | WORQ Menara UOA Bangsar | WORQ KL Sdn Bhd |
| SPM | WORQ Sunway Putra | WORQ KL Sdn Bhd |
| ITG | WORQ Intermark | WORQ KL Sdn Bhd |

---

## Price Catalogue Structure (`Hardware & Services` tab)

**Columns:** A=Category | B=Brand | C=Item Description | D=Cost/Unit | E=Cost Price | F=Price | G=Charge Type | H=Remark

**Key rules:**
- Row with **non-empty Category (A)** = start of new item group (parent row)
- Rows with **blank Category** = sub-components of the previous item (Cost/Unit in col D)
- **Cost Price (E)** and **Price (F)** only populated on parent row (sum of sub-components)
- Item Description (C) contains full bundled description with `a) b) c)` sub-items

**Markup options (user selects in sidebar):**

| Markup % | Formula |
|---|---|
| 10% | `Price = Cost Price / 0.9` |
| 20% | `Price = Cost Price / 0.8` |
| 25% | `Price = Cost Price / 0.75` |
| **30% (default)** | `Price = Cost Price / 0.7` |

Unit Price field is editable after markup is applied.

---

## Quote Number Logic

**Format:** `WORQ/{LOCATION}/{YEAR}/{RUNNING_NUMBER}`

**Examples:**
```
WORQ/ITG/2026/10
WORQ/TTDI/2026/11   ← same running sequence, different location
WORQ/TTDI/2026/12
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

---

## Project File Structure

```
03 QUOTATION GENERATOR/
├── appsscript.json          ← OAuth scopes, timezone (Asia/Kuala_Lumpur), V8 runtime
├── .clasp.json              ← auto-generated by clasp create
├── .claspignore             ← excludes README, DOCUMENTATION.md, node_modules
├── Code.gs                  ← onOpen, menu, openSidebar, getSelectedRowData, getNextQuoteNumber, getLocations
├── Sidebar.gs               ← getInitialData, getCatalogueItems, generateQuotation, sendEmail, updateTrackerRow
├── PdfGenerator.gs          ← buildHtmlQuotation, convertHtmlToPdf, getLogoBase64
├── DriveManager.gs          ← savePdf
├── sidebar.html             ← Sidebar UI (vanilla JS, inline CSS)
└── quotation-template.html  ← PDF layout (HtmlTemplate scriptlets)
```

---

## Sidebar UI Flow

```
1. User clicks any row in Tracker sheet (optional — for revision pre-fill)
2. Clicks "WORQ Tools > Generate Quotation"
3. Sidebar opens:

   ┌──────────────────────────────────────┐
   │ WORQ Quotation Generator             │
   │                                      │
   │ Location: [WORQ Intermark (ITG) ▼]   │
   │ Quote No:  WORQ/ITG/2026/11 (auto)   │
   │ [ ] Is this a revision?              │
   │ Date: 26 Mar 2026 (today, locked)    │
   │                                      │
   │ ── Customer Details ──               │
   │ Company:  [_______________________]  │
   │ Address:  [_______________________]  │
   │           [_______________________]  │
   │ Email:    [_______________________]  │
   │                                      │
   │ ── Items ──                          │
   │ Markup: ○10% ○20% ○25% ●30%         │
   │                                      │
   │ Search: [___________]                │
   │ ┌─────────────────────────────────┐  │
   │ │ Card Reader + PIN (ZKTeco)      │  │
   │ │ Card + Face Reader (ZKTeco)     │  │
   │ │ IP Camera 4MP (TPLink)          │  │
   │ └─────────────────────────────────┘  │
   │                    [Add Item]        │
   │                                      │
   │ ┌───────────────┬───┬───────┬──────┐ │
   │ │ Description   │Qty│ Price │Total │ │
   │ ├───────────────┼───┼───────┼──────┤ │
   │ │ Card+PIN…     │ 1 │4700.00│4700  │ │
   │ └───────────────┴───┴───────┴──────┘ │
   │                                      │
   │ Running Total: MYR 4,700.00          │
   │                                      │
   │      [Generate Quotation]            │
   └──────────────────────────────────────┘

4. Click Generate → spinner → PDF generated → opens in new tab
5. Tracker row updated automatically (Quote#, Drive link, Quoted Price, Cost Price)
```

---

## PDF Layout (matches existing quotation template)

```
┌──────────────────────────────────────────┐
│ [WORQ Logo img]    WORQ Integra           │
│                    WORQ KL SDN BHD        │
│                    Suite 09-01, Level 9.. │
│                    integra@worq.space     │
├──────────────────────────────────────────┤
│ Quotation          Quotation Date         │
│                    26 Mar 2026            │
│ Customer Name                             │
│ Customer Address   Quotation Number       │
│                    WORQ/ITG/2026/11       │
├──────────────────────────────────────────┤
│ Description      │ Qty │ Unit Price │ Amt │
├──────────────────┴─────┴────────────┴────┤
│ Door Access  (bold category header)       │
│ 1. Item description          1   200.00  │
│ 2. Another item              1   400.00  │
│ Networking  (bold category header)        │
│ 3. Switch                    1   800.00  │
├──────────────────────────────────────────┤
│                       TOTAL MYR 1,400.00 │
├──────────────────────────────────────────┤
│ PAYMENT DETAILS                           │
│ Bank: Malayan Banking Berhad (Maybank)   │
│ Account Name: Worq KL Sdn Bhd           │
│ Account No: 512222641522                 │
│ SWIFT: MBBEMYKL                          │
│ Payment Reference: WORQ/ITG/2026/11      │
├──────────────────────────────────────────┤
│ Terms & Conditions                        │
│ Warranty: 12 months (manufacturer)       │
│ Validity: 30 days from quotation date    │
│ Payment Terms: 100% upon completion      │
├──────────────────────────────────────────┤
│   Thank you — We really appreciate       │
│             your business!               │
└──────────────────────────────────────────┘
```

**PDF Generation method:** HTML string → `DriveApp.createFile(blob)` → `.getAs('application/pdf')` → trash temp file → save PDF blob to Drive folder.

**Logo:** Fetched from Drive using `LOGO_FILE_ID`, converted to base64 data URI and embedded in `<img src="data:image/png;base64,...">` — ensures logo renders during Drive's HTML→PDF conversion.

---

## Output Actions (all automatic on "Generate")

1. PDF saved to Drive folder → filename: `WORQ-ITG-2026-11.pdf`
2. Tracker Column B updated with Quote Number (new quotes only)
3. Tracker Column F updated with Drive PDF link
4. Tracker Column G updated with Quoted Price
5. Tracker Column H updated with Cost Price
6. PDF emailed to customer (GmailApp, PDF as attachment)
7. PDF opened in new browser tab for immediate review

---

## Clasp Dev Workflow

```bash
# One-time setup
git clone https://github.com/Aurorary/AS_quotation_generator.git
cd AS_quotation_generator

npm install -g @google/clasp
clasp login
# Enable Apps Script API first: script.google.com/home/usersettings
clasp create --title "WORQ Quotation Generator" --type sheets \
  --parentId 1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0

# Daily development
clasp push           # push local changes to Apps Script
clasp push --watch   # auto-push on file save
clasp open           # open Apps Script editor in browser
clasp logs           # view Stackdriver logs for debugging
```

After each `clasp push`: reload the Tracker spreadsheet in browser to test changes.

---

## Setup Checklist

- [ ] `npm install -g @google/clasp` and `clasp login`
- [ ] Apps Script API enabled at script.google.com/home/usersettings
- [ ] `clasp create` run with Tracker spreadsheet ID as `--parentId`
- [ ] All 8 Script Properties set in Apps Script Project Settings
- [ ] **Test:** "WORQ Tools" menu appears after reload
- [ ] **Test:** Sidebar opens, location dropdown populated, quote number auto-generates
- [ ] **Test:** Catalogue loads, search filters work, markup applies correctly
- [ ] **Test:** PDF generates with correct location address, logo, grouped items
- [ ] **Test:** Drive folder receives PDF file named correctly
- [ ] **Test:** Customer email received with PDF attached
- [ ] **Test:** Tracker row updated (Quote#, Drive link, Quoted Price, Cost Price)