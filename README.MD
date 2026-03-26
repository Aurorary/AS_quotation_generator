# WORQ Quotation Generator

Automates the WORQ KL IT quotation workflow. A modal dialog in the Tracker Google Sheet lets the team pick items from the product catalogue, preview the quotation, then confirm — generating a branded PDF, saving it to Drive, emailing it to the customer, and logging everything back to the tracker.

## How It Works

1. Open the **Quotation Tracker** Google Sheet
2. Click **Quotation Generator > Generate Quotation** from the menu
3. Fill in the modal: location, customer details, pick items from catalogue
4. Click **Generate Quotation** → review the preview
5. Click **Confirm & Send** → PDF saved to Drive, emailed to customer, tracker row appended

## Tech Stack

- Google Apps Script (bound to Tracker spreadsheet)
- clasp — local development and version control
- HTML Service — modal dialog UI (1000×750px)
- DriveApp — PDF generation and storage
- GmailApp — send PDF to customer

## Project Files

| File | Purpose |
|---|---|
| `Code.gs` | Menu setup, quote number logic, location data, cache management |
| `Sidebar.gs` | Server-side functions: preview, confirm, catalogue, tracker update |
| `PdfGenerator.gs` | Builds HTML quotation and converts to PDF |
| `DriveManager.gs` | Saves PDF to Google Drive |
| `sidebar.html` | Modal dialog UI (HTML + vanilla JS) |
| `quotation-template.html` | PDF layout template |
| `appsscript.json` | Apps Script manifest (OAuth scopes, runtime) |

## Key Google Sheets

| Sheet | Purpose |
|---|---|
| [Quotation Tracker](https://docs.google.com/spreadsheets/d/1DbX1hTx8pHoqzyRZ5AuikECJf2CSC2f__T8k2htZtG0) | Master list of all quotes — script bound here, ADDRESS tab included |
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
clasp push --force
```

Then run `setupScriptProperties()` from the Apps Script editor to set all required properties.

## Quote Number Format

```
WORQ/{LOCATION}/{YEAR}/{RUNNING_NUMBER}

Examples:
  WORQ/ITG/2026/10
  WORQ/TTDI/2026/11
  WORQ/ITG/2026/11 rev1   ← revision
  WORQ/ITG/2026/11 rev2   ← second revision
```

Running number is sequential across all locations. Revisions always append a new row.

## Supported Locations

Managed dynamically in the **ADDRESS tab** of the Tracker sheet — no code changes needed to add/update locations.

Current outlets: TTDI · UBP · KLG · STO · KLS · MUB · SPM · ITG · SVT · BU · APT · MSH

## Menu Options

| Option | Description |
|---|---|
| Generate Quotation | Opens the quotation modal dialog |
| Clear Cache | Clears catalogue + logo cache (use after updating the catalogue sheet) |
