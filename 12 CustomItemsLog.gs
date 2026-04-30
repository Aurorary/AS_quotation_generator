// ============================================================
// CustomItemsLog.gs — Hidden log of every custom item used
// ============================================================
// The catalogue stays curated. Custom items get logged here so we can
// later see "we've quoted Cat 6 cable 8 times in 3 months — formalize it"
// without auto-polluting the catalogue with one-off prices.
//
// Schema: A=timestamp B=quoteNumber C=customer D=description
//         E=category F=chargeType G=qty H=unitPrice I=costPrice
//         J=lineTotal K=drafter L=context (sent / draft)

const CUSTOM_ITEMS_TAB_NAME = '_custom_items';
const CUSTOM_ITEMS_HEADER = [
  'Timestamp', 'Quote #', 'Customer', 'Description',
  'Category', 'Charge Type', 'Qty', 'Unit Price', 'Cost Price',
  'Line Total', 'Drafter / Sender', 'Context'
];

function getCustomItemsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CUSTOM_ITEMS_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CUSTOM_ITEMS_TAB_NAME);
    sheet.getRange(1, 1, 1, CUSTOM_ITEMS_HEADER.length).setValues([CUSTOM_ITEMS_HEADER]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

// Append one row per custom item in the payload. Re-logs on draft updates
// because the description / price / qty may have changed during edit.
// Catalogue items are skipped — they're already in the catalogue.
function logCustomItems(payload, context) {
  try {
    const items = (payload && payload.items) || [];
    const customs = items.filter(function(it) { return it && it.isCustom; });
    if (customs.length === 0) return;

    const sheet = getCustomItemsSheet_();
    const user = getCurrentUser();
    const now = new Date();
    const rows = customs.map(function(it) {
      const qty       = parseFloat(it.qty) || 0;
      const unitPrice = parseFloat(it.unitPrice) || 0;
      const costPrice = parseFloat(it.catalogueCostPrice) || 0;
      const lineTotal = parseFloat(it.lineTotal) || (qty * unitPrice);
      return [
        now,
        payload.quoteNumber || '',
        payload.customerName || '',
        (it.description || '').toString().trim(),
        it.category || '',
        it.chargeType || '',
        qty,
        unitPrice,
        costPrice,
        lineTotal,
        user,
        context || ''
      ];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } catch (e) {
    // Logging is best-effort — never block a send/draft over a log failure
    Logger.log('logCustomItems error: ' + e.message);
  }
}
