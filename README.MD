# WORQ Quotation Generator

Automates the WORQ KL IT quotation workflow. Replaces manual Google Sheets copy-paste with a sidebar-driven tool that generates a branded PDF, saves it to Drive, emails it to the customer, and logs everything back to the tracker — in one click.

## How It Works

1. Open the **Quotation Tracker** Google Sheet
2. Click **WORQ Tools > Generate Quotation** from the menu
3. Fill in the sidebar: location, customer details, pick items from catalogue
4. Click **Generate Quotation**
5. PDF is created, saved to Drive, emailed to customer, and the tracker row is updated automatically

## Tech Stack

- Google Apps Script (bound to Tracker spreadsheet)
- clasp — local development and version control
- HTML Service — sidebar UI
- DriveApp — PDF generation and storage
- GmailApp — send PDF to customer

## Project Files

| File | Purpose |
|---|---|
| `Code.gs` | Menu setup, quote number logic, location data |
| `Sidebar.gs` | Server-side functions called from the sidebar |
| `PdfGenerator.gs` | Builds HTML quotation and converts to PDF |
| `DriveManager.gs` | Saves PDF to Google Drive |
| `sidebar.html` | Sidebar UI (HTML + vanilla JS) |
| `quotation-template.html` | PDF layout template |
| `appsscript.json` | Apps Script manifest (OAuth scopes, runtime) |

## Key Google Sheets

| Sheet | Purpose |
|---|---|
| [Quotation Tracker](https://docs.google.com/spreadsheets/d/1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0) | Master list of all quotes — script is bound here |
| [Quotation Template + Address](https://docs.google.com/spreadsheets/d/1a9ggAV7RN796FgFM9d5rQ-qIAGKAYGkDycK8l0CeKoY) | ADDRESS tab (locations), QUOTATION TEMPLATE tab |
| [Price Catalogue](https://docs.google.com/spreadsheets/d/1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps) | Hardware & Services tab — items, cost prices, selling prices |

## Repositories

| Repo | URL |
|---|---|
| GitHub | https://github.com/Aurorary/AS_quotation_generator.git |

## Setup

See [DOCUMENTATION.md](DOCUMENTATION.md) for full setup instructions, Script Property keys, and testing checklist.

### Quick Start

```bash
# Clone the repo
git clone https://github.com/Aurorary/AS_quotation_generator.git
cd AS_quotation_generator

npm install -g @google/clasp
clasp login
clasp create --title "WORQ Quotation Generator" --type sheets \
  --parentId 1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0
clasp push
```

Then set all Script Properties in **Apps Script > Project Settings > Script Properties** (see DOCUMENTATION.md for the full list).

## Quote Number Format

```
WORQ/{LOCATION}/{YEAR}/{RUNNING_NUMBER}

Examples:
  WORQ/ITG/2026/10
  WORQ/TTDI/2026/11
  WORQ/ITG/2026/10 rev1   ← revision
```

Running number is sequential across all locations.

## Supported Locations

TTDI · UBP · KLG · STO · KLS · MUB · SPM · ITG

Locations and addresses are managed in the ADDRESS tab of the Template sheet — no code changes needed to add/update a location.