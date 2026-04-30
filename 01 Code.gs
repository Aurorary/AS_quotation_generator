// ============================================================
// Code.gs — Menu, sidebar trigger, quote number, locations
// ============================================================

// ── Script Properties helpers ───────────────────────────────
function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// ── Debug: dump location address structure ──────────────────
// Run from editor. Tells us exactly how the ADDRESS tab data is shaped
// after split — useful for diagnosing missing-address-in-PDF bugs.
function debugLocationAddr() {
  const locs = getLocations();
  locs.forEach(function(l) {
    const raw = l.fullAddress || '';
    Logger.log('--- ' + l.code + ' ---');
    Logger.log('Raw bytes (escaped): ' + JSON.stringify(raw));
    Logger.log('Split by \\n count: ' + raw.split('\n').length);
    Logger.log('Lines: ' + JSON.stringify(raw.split('\n')));
    Logger.log('getLocationAddrTail result: ' + JSON.stringify(getLocationAddrTail(raw)));
  });
}

// ── Debug: identity / scopes ────────────────────────────────
// Run this from the editor and paste the output. Tells us whether the
// userinfo.email scope is actually granted, and what each Session method
// returns under the current auth.
function debugIdentity() {
  let activeEmail = '(unknown)';
  let activeError = null;
  try { activeEmail = Session.getActiveUser().getEmail(); }
  catch (e) { activeError = e.message; }

  let effectiveEmail = '(unknown)';
  let effectiveError = null;
  try { effectiveEmail = Session.getEffectiveUser().getEmail(); }
  catch (e) { effectiveError = e.message; }

  Logger.log('Active user email: ' + activeEmail + (activeError ? '   ERROR: ' + activeError : ''));
  Logger.log('Effective user email: ' + effectiveEmail + (effectiveError ? '   ERROR: ' + effectiveError : ''));
  Logger.log('Manifest scopes: ' + JSON.stringify(ScriptApp.getOAuthToken ? 'token-issued' : 'no-token'));
}

// ── Debug: log what getLocations actually reads ──────────────
function debugLocations() {
  const tabName = getProp('ADDRESS_TAB_NAME') || 'ADDRESS';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Looking for tab: ' + tabName);
  Logger.log('All tabs: ' + ss.getSheets().map(function(s){ return s.getName(); }).join(', '));
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) { Logger.log('TAB NOT FOUND'); return; }
  const rows = sheet.getDataRange().getValues();
  Logger.log('Total rows: ' + rows.length);
  Logger.log('Row 0 (header): ' + JSON.stringify(rows[0]));
  if (rows.length > 1) Logger.log('Row 1: ' + JSON.stringify(rows[1]));
  if (rows.length > 2) Logger.log('Row 2: ' + JSON.stringify(rows[2]));
  Logger.log('getLocations result: ' + JSON.stringify(getLocations()));
}

// ── One-time setup — run this once to set all Script Properties ──
function setupScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    'TRACKER_SHEET_TAB':  'NEW COMBINED',
    'ADDRESS_TAB_NAME':   'ADDRESS',
    'CATALOGUE_SHEET_ID': '1aqTyUVxbtaDQh9vzuzxsZAZYl5AM1oyli4vbWZZNSps',
    'CATALOGUE_TAB_NAME': 'Hardware & Services',
    'LOGO_FILE_ID':           '1e1WWzk00qzDRwA82uWOTYZFHjYidP5Q7',
    'QUOTATIONS_FOLDER_ID':   '1HgsVQlCmjTOF8jn0l77iRq5_6ViCqHP5',
    'PDF_TEMPLATE_DOC_ID':    '1kzSi1wa0F1Vd_l0Yr04Np1wO3aGviB9-zCpkN71eFAY'
  });
  CacheService.getScriptCache().removeAll(['catalogue', 'logoDataUri']);
  Logger.log('Script properties set and cache cleared.');
}

// ── Menu ────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Quotation Generator')
    .addItem('Generate Quotation', 'openSidebar')
    .addSeparator()
    .addItem('Clear Cache', 'clearCache')
    .addToUi();
}

function clearCache() {
  CacheService.getScriptCache().removeAll(['catalogue', 'logoDataUri']);
  SpreadsheetApp.getUi().alert('Cache cleared. Catalogue will reload fresh on next open.');
}

// ── Open modal dialog ────────────────────────────────────────
function openSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('03 Sidebar')
    .setTitle('Quotation Generator')
    .setWidth(1000)
    .setHeight(750);
  SpreadsheetApp.getUi().showModalDialog(html, 'Quotation Generator');
}

// ── Web app entry point ──────────────────────────────────────
function doGet() {
  return HtmlService.createHtmlOutputFromFile('08 WebApp')
    .setTitle('WORQ Quotation Generator')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Current viewer (used by web app for permission gating) ──
// Try active first (the *viewer* in a web-app context). If the userinfo
// scope isn't granted (workspace policy, deployment older than scope was
// added, etc.) fall back to effective (the *owner*). Last resort: empty.
// Returning empty downgrades approver gating to "everyone needs approval";
// the system keeps working, the policy just becomes more conservative.
function getCurrentUser() {
  try {
    const a = Session.getActiveUser().getEmail();
    if (a) return a;
  } catch (e) { /* fall through */ }
  try {
    const e = Session.getEffectiveUser().getEmail();
    if (e) return e;
  } catch (e2) { /* fall through */ }
  return '';
}

const APPROVER_EMAILS = ['afdhal@worq.space'];
const APPROVAL_THRESHOLD_MYR = 10000;

function isApprover(email) {
  return APPROVER_EMAILS.indexOf((email || '').toLowerCase()) !== -1;
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
  const tabName = getProp('ADDRESS_TAB_NAME') || 'ADDRESS';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    Logger.log('ERROR: Cannot find tab "' + tabName + '". Available tabs: ' + ss.getSheets().map(function(s){ return s.getName(); }).join(', '));
    return [];
  }
  const rows = sheet.getDataRange().getValues();

  // Row 0 = header; skip rows with blank code
  const locations = [];
  for (let i = 1; i < rows.length; i++) {
    const code = rows[i][0] ? rows[i][0].toString().trim() : '';
    if (!code) continue;
    locations.push({
      code: code,
      fullAddress: rows[i][1] ? rows[i][1].toString().trim() : '',
      email: rows[i][2] ? rows[i][2].toString().trim() : '',
      accountNo: rows[i][3] ? rows[i][3].toString().trim() : ''
    });
  }
  return locations;
}
