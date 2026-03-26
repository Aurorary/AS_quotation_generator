// ============================================================
// Code.gs — Menu, sidebar trigger, quote number, locations
// ============================================================

// ── Script Properties helpers ───────────────────────────────
function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// ── Menu ────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WORQ Tools')
    .addItem('Generate Quotation', 'openSidebar')
    .addToUi();
}

// ── Open sidebar ────────────────────────────────────────────
function openSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('WORQ Quotation Generator')
    .setWidth(420);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ── Get selected row data (for revision pre-fill) ───────────
function getSelectedRowData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);
  const row = sheet.getActiveCell().getRow();

  // Row 1 is header — return null if nothing useful selected
  if (row <= 1) return null;

  const values = sheet.getRange(row, 1, 1, 11).getValues()[0];
  const quoteNumber = values[1] ? values[1].toString().trim() : '';

  // Extract location code from existing quote number (WORQ/ITG/2026/10 → ITG)
  let locationCode = '';
  if (quoteNumber) {
    const parts = quoteNumber.split('/');
    if (parts.length >= 2) locationCode = parts[1];
  }

  return {
    rowIndex: row,
    date: values[0] ? Utilities.formatDate(new Date(values[0]), 'Asia/Kuala_Lumpur', 'dd-MMM-yyyy') : '',
    quoteNumber: quoteNumber,
    customer: values[2] ? values[2].toString().trim() : '',
    locationCode: locationCode
  };
}

// ── Auto-generate next quote number ─────────────────────────
function getNextQuoteNumber(locationCode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = getProp('TRACKER_SHEET_TAB') || 'NEW COMBINED';
  const sheet = ss.getSheetByName(tabName);
  const lastRow = sheet.getLastRow();

  const year = new Date().getFullYear().toString();
  let maxNum = 0;

  if (lastRow > 1) {
    const colB = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    const pattern = new RegExp(`^WORQ/[A-Z]+/${year}/(\\d+)`, 'i');

    colB.forEach(function(r) {
      const val = r[0] ? r[0].toString().trim() : '';
      const match = val.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
  }

  const nextNum = maxNum + 1;
  return `WORQ/${locationCode}/${year}/${nextNum}`;
}

// ── Fetch locations from ADDRESS tab ────────────────────────
function getLocations() {
  const sheetId = getProp('ADDRESS_SHEET_ID');
  const tabName = getProp('ADDRESS_TAB_NAME') || 'ADDRESS';

  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(tabName);
  const rows = sheet.getDataRange().getValues();

  // Row 0 = header; skip rows with blank code
  const locations = [];
  for (let i = 1; i < rows.length; i++) {
    const code = rows[i][0] ? rows[i][0].toString().trim() : '';
    if (!code) continue;
    locations.push({
      code: code,
      fullAddress: rows[i][1] ? rows[i][1].toString().trim() : '',
      email: rows[i][2] ? rows[i][2].toString().trim() : ''
    });
  }
  return locations;
}
