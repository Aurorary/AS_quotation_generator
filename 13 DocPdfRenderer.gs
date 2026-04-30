// ============================================================
// DocPdfRenderer.gs — Render the quotation PDF via a Doc template
// ============================================================
// Drive's HTML→PDF converter ignores most CSS. Google Docs renders to PDF
// faithfully. This module copies a template Doc, fills placeholders + the
// items table from the payload, exports as PDF, and trashes the temp Doc.
//
// The HTML preview path (07 quotation_template.html) is unchanged — that's
// what the iframe shows during preview. Only the final PDF rendering moved
// to Docs.

// Simple text-replace placeholders. Multi-line ones (customerAddr,
// locationAddr) are NOT in this list — they're handled separately by
// fillMultilinePlaceholder_ AFTER this pass runs.
const DOC_PLACEHOLDERS_TEXT = [
  'quoteDate', 'quoteNumber', 'customerName',
  'locationName', 'locationCompany', 'locationEmail',
  'accountNo', 'totalFormatted'
];

// Items-row marker — a row whose first cell contains this string.
const DOC_ITEMS_MARKER = '{{ITEMS_GO_HERE}}';
// Charge-group marker — same scheme.
const DOC_CHARGE_GROUPS_MARKER = '{{chargeGroupRows}}';
// Customer address — multi-line replacement (separate handling)
const DOC_CUSTOMER_ADDR_MARKER = '{{customerAddr}}';
// Location address — multi-line replacement
const DOC_LOCATION_ADDR_MARKER = '{{locationAddr}}';

// ── Public entry: render PDF blob from a payload via the Doc template ──
// `prefix` is prepended to the filename (e.g. "[DRAFT] " for drafts).
function renderPdfViaDoc(payload, loc, prefix) {
  const tmplId = getProp('PDF_TEMPLATE_DOC_ID');
  if (!tmplId) throw new Error('PDF_TEMPLATE_DOC_ID not configured. Run setupScriptProperties.');

  const totalFormatted = formatMyr(payload.quotedPrice || 0);
  const subs = {
    quoteDate:       payload.quoteDate || '',
    quoteNumber:     payload.quoteNumber || '',
    customerName:    payload.customerName || '',
    locationName:    parseLocationLine(loc.fullAddress, 0),
    locationCompany: parseLocationLine(loc.fullAddress, 1),
    locationEmail:   loc.email || '',
    accountNo:       loc.accountNo || '512222641522',
    totalFormatted:  totalFormatted
  };

  const fileName = '__tmp__ ' + (payload.quoteNumber || 'quotation') + ' ' + new Date().getTime();
  const copy = DriveApp.getFileById(tmplId).makeCopy(fileName);
  let pdfBlob = null;
  try {
    const doc = DocumentApp.openById(copy.getId());
    const body = doc.getBody();

    // 1. Simple text placeholders. Coerce to string — replaceText rejects
    //    numbers (sheet account numbers etc) with "Invalid argument: replacement".
    DOC_PLACEHOLDERS_TEXT.forEach(function(key) {
      const val = subs[key];
      const safe = (val === null || val === undefined) ? '' : String(val);
      body.replaceText('\\{\\{' + key + '\\}\\}', safe);
    });

    // 2. Multi-line addresses (must NOT be in DOC_PLACEHOLDERS_TEXT)
    fillMultilinePlaceholder_(body, DOC_CUSTOMER_ADDR_MARKER, payload.customerAddress || '');
    fillMultilinePlaceholder_(body, DOC_LOCATION_ADDR_MARKER, getLocationAddrTail(loc.fullAddress));

    // 3. Items table
    fillItemsTable_(body, payload);

    // 4. Charge-group rows (or remove the marker row entirely)
    fillChargeGroupRows_(body, payload);

    doc.saveAndClose();
    pdfBlob = copy.getAs('application/pdf');
    pdfBlob.setName(buildPdfFileName(payload.quoteNumber, payload.customerName, prefix));
  } finally {
    try { copy.setTrashed(true); } catch (e) { Logger.log('Failed to trash temp doc: ' + e.message); }
  }
  return pdfBlob;
}

// ── Address helpers ─────────────────────────────────────────────────

function parseLocationLine(fullAddress, idx) {
  const lines = (fullAddress || '').split('\n').map(function(s) { return s.trim(); });
  return lines[idx] || '';
}

function getLocationAddrTail(fullAddress) {
  const lines = (fullAddress || '').split('\n').map(function(s) { return s.trim(); });
  return lines.slice(2).filter(Boolean).join('\n');
}

// ── Multi-line placeholder fill ─────────────────────────────────────
// Captures the containing paragraph, replaces the marker with line 0 in
// place (preserving styling), then inserts each remaining line as a sibling
// paragraph immediately after.
function fillMultilinePlaceholder_(body, markerText, value) {
  const found = body.findText(escRegex_(markerText));
  if (!found) return;

  const lines = String(value || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  if (lines.length === 0) { body.replaceText(escRegex_(markerText), ''); return; }

  const para = getContainingParagraph_(found.getElement());
  if (!para) { body.replaceText(escRegex_(markerText), lines.join(', ')); return; }

  // Capture the original paragraph's alignment + text-level attributes BEFORE
  // we mutate. We apply alignment at paragraph level and font/size/colour at
  // text level — copying via getAttributes() drops some properties on
  // certain element states.
  let alignment = null;
  let textAttrs = null;
  try { alignment = para.getAlignment(); } catch (e) {}
  try {
    const t = para.editAsText();
    if (t.getText().length > 0) textAttrs = t.getAttributes(0);
  } catch (e) {}

  const parent = para.getParent();
  const startIdx = parent.getChildIndex(para);

  body.replaceText(escRegex_(markerText), lines[0]);

  for (let i = 1; i < lines.length; i++) {
    let newPara = null;
    try { newPara = parent.insertParagraph(startIdx + i, lines[i]); }
    catch (e) { Logger.log('insertParagraph failed for "' + lines[i] + '": ' + e.message); continue; }
    if (!newPara) continue;
    // Apply alignment at paragraph level (RIGHT/LEFT/CENTER)
    if (alignment) {
      try { newPara.setAlignment(alignment); } catch (e) {}
    }
    // Apply text-level styles (font size, weight, colour) so each new line
    // visually matches the original placeholder line.
    if (textAttrs) {
      try {
        const t = newPara.editAsText();
        const len = t.getText().length;
        if (len > 0) t.setAttributes(0, len - 1, textAttrs);
      } catch (e) {}
    }
  }
}

// ── DOM walk helpers ────────────────────────────────────────────────

function getContainingParagraph_(el) {
  let cur = el;
  while (cur && cur.getType() !== DocumentApp.ElementType.PARAGRAPH) {
    cur = cur.getParent();
  }
  return cur;
}

function getContainingTableCell_(el) {
  let cur = el;
  while (cur) {
    if (cur.getType() === DocumentApp.ElementType.TABLE_CELL) return cur;
    cur = cur.getParent();
  }
  return null;
}

function escRegex_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Items table injection ───────────────────────────────────────────

function fillItemsTable_(body, payload) {
  const found = body.findText(escRegex_(DOC_ITEMS_MARKER));
  if (!found) throw new Error('Items marker not found in template: ' + DOC_ITEMS_MARKER);

  const tableCell = getContainingTableCell_(found.getElement());
  if (!tableCell) throw new Error('Items marker is not inside a table cell');
  const tableRow = tableCell.getParentRow();
  const table = tableRow.getParentTable();
  const markerRowIdx = table.getChildIndex(tableRow);
  const numCols = tableRow.getNumCells();

  const specs = buildItemRowSpecs_(payload);
  for (let i = 0; i < specs.length; i++) {
    const newRow = table.insertTableRow(markerRowIdx + i);
    while (newRow.getNumCells() < numCols) newRow.appendTableCell('');
    fillRowSpec_(newRow, specs[i]);
  }
  table.removeRow(markerRowIdx + specs.length);
}

// Build the ordered list of rows to inject.
//   { kind: 'category', label }
//   { kind: 'item',   index, descLines, subComponents, chargeType, qty, unitPrice, lineTotal, showPrice }
//   { kind: 'sub',    desc, chargeType, qty, unitPrice, lineTotal, showPrice }
function buildItemRowSpecs_(payload) {
  const items = payload.items || [];
  const groups = {};
  const order = [];
  items.forEach(function(it) {
    const cat = it.category || 'General';
    if (!groups[cat]) { groups[cat] = []; order.push(cat); }
    groups[cat].push(it);
  });

  const specs = [];
  let counter = 1;
  order.forEach(function(cat) {
    specs.push({ kind: 'category', label: cat });
    groups[cat].forEach(function(it) {
      const subComponents = (it.subRows || []).filter(function(s) { return !(s.price > 0); });
      const pricedSubs    = (it.subRows || []).filter(function(s) { return s.price > 0; });
      const extras        = it.extraPriceRows || [];

      // Hoist a single shared sub-row chargeType to the parent if the parent
      // has none (avoids the pill landing on a random sub-component).
      let parentChargeType = it.chargeType || '';
      const subChargeTypes = subComponents.map(function(s) { return s.chargeType || ''; }).filter(Boolean);
      if (!parentChargeType && subChargeTypes.length > 0) {
        const distinct = subChargeTypes.filter(function(c, i) { return subChargeTypes.indexOf(c) === i; });
        if (distinct.length === 1) parentChargeType = distinct[0];
      }
      const renderedSubComponents = subComponents.map(function(s) {
        return {
          desc: s.description || '',
          chargeType: parentChargeType && (s.chargeType === parentChargeType) ? '' : (s.chargeType || '')
        };
      });

      // Description may span multiple lines (e.g. "Title\nDetail line\na) Item")
      const descLines = (it.description || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);

      specs.push({
        kind: 'item',
        index: counter,
        descLines: descLines.length > 0 ? descLines : [''],
        subComponents: renderedSubComponents,
        chargeType: parentChargeType,
        qty: it.qty || 0,
        unitPrice: it.unitPrice || 0,
        lineTotal: it.lineTotal || 0,
        showPrice: (it.unitPrice || 0) > 0
      });
      pricedSubs.forEach(function(sub) {
        specs.push({
          kind: 'sub',
          desc: sub.description || '',
          chargeType: sub.chargeType || '',
          qty: it.qty || 0,
          unitPrice: sub.price || 0,
          lineTotal: (sub.price || 0) * (it.qty || 1),
          showPrice: (sub.price || 0) > 0
        });
      });
      extras.forEach(function(ep) {
        specs.push({
          kind: 'sub',
          desc: ep.description || '',
          chargeType: ep.chargeType || '',
          qty: it.qty || 0,
          unitPrice: ep.price || 0,
          lineTotal: (ep.price || 0) * (it.qty || 1),
          showPrice: (ep.price || 0) > 0
        });
      });
      counter++;
    });
  });
  return specs;
}

function fillRowSpec_(row, spec) {
  const c0 = row.getCell(0);
  const c1 = row.getCell(1);
  const c2 = row.getCell(2);
  const c3 = row.getCell(3);
  [c0, c1, c2, c3].forEach(clearCell_);

  if (spec.kind === 'category') {
    const p = c0.appendParagraph(spec.label);
    try { p.setHeading(DocumentApp.ParagraphHeading.NORMAL); } catch (e) {}
    // Force font size aggressively — set on the paragraph's text element
    // directly because the template's inherited cell style overrides
    // setAttributes-level changes in some Doc states.
    try {
      const t = p.editAsText();
      const len = t.getText().length;
      if (len > 0) {
        t.setFontSize(0, len - 1, 9);
        t.setBold(0, len - 1, true);
        t.setUnderline(0, len - 1, true);
        t.setForegroundColor(0, len - 1, '#1a1a1a');
        t.setBackgroundColor(0, len - 1, '#f0f0f0');
      }
    } catch (e) { Logger.log('category text styling failed: ' + e.message); }
    return;
  }

  if (spec.kind === 'item') {
    // Description may be multi-line. Line 0 is the title (with pill inline);
    // lines 1+ render as separate non-bold paragraphs beneath. This avoids
    // the pill landing at the END of a long description block.
    const titleLine = (spec.descLines[0] || '').trim();
    const extraLines = spec.descLines.slice(1);

    const mainPara = c0.appendParagraph(spec.index + '. ' + titleLine);
    try { mainPara.setHeading(DocumentApp.ParagraphHeading.NORMAL); } catch (e) {}
    try {
      const mt = mainPara.editAsText();
      const mlen = mt.getText().length;
      if (mlen > 0) {
        mt.setFontSize(0, mlen - 1, 9);
        mt.setBold(0, mlen - 1, true);
      }
    } catch (e) {}
    if (spec.chargeType) {
      const tag = mainPara.appendText('   [' + spec.chargeType + ']');
      setTextAttrs_(tag, {
        BOLD: false,
        ITALIC: true,
        FONT_SIZE: 8,
        FOREGROUND_COLOR: spec.chargeType === 'Monthly' ? '#0055aa' : '#555555'
      });
    }
    extraLines.forEach(function(line) {
      const p = c0.appendParagraph(line);
      try { p.setHeading(DocumentApp.ParagraphHeading.NORMAL); } catch (e) {}
      setParaAttrs_(p, { BOLD: false, FONT_SIZE: 8.5, FOREGROUND_COLOR: '#222222' });
    });

    // True structural sub-components (subRows from catalogue parser).
    spec.subComponents.forEach(function(sc, i) {
      const desc = (sc.desc || '').trim();
      const alreadyLettered = /^[a-z]\)\s/i.test(desc);
      const subText = alreadyLettered
        ? desc
        : String.fromCharCode(97 + i) + ') ' + desc;
      const sp = c0.appendParagraph(subText);
      try { sp.setHeading(DocumentApp.ParagraphHeading.NORMAL); } catch (e) {}
      setParaAttrs_(sp, { BOLD: false, FONT_SIZE: 8.5, FOREGROUND_COLOR: '#222222' });
      if (sc.chargeType) {
        const stag = sp.appendText('   [' + sc.chargeType + ']');
        setTextAttrs_(stag, {
          ITALIC: true,
          FONT_SIZE: 7.5,
          FOREGROUND_COLOR: sc.chargeType === 'Monthly' ? '#0055aa' : '#555555'
        });
      }
    });

    setCellPlain_(c1, String(spec.qty), { ALIGNMENT: DocumentApp.HorizontalAlignment.CENTER });
    setCellPlain_(c2, spec.showPrice ? formatMyr(spec.unitPrice) : '—', { ALIGNMENT: DocumentApp.HorizontalAlignment.RIGHT });
    setCellPlain_(c3, spec.showPrice ? formatMyr(spec.lineTotal) : '—', { ALIGNMENT: DocumentApp.HorizontalAlignment.RIGHT });
    return;
  }

  if (spec.kind === 'sub') {
    const p = c0.appendParagraph(spec.desc);
    try { p.setHeading(DocumentApp.ParagraphHeading.NORMAL); } catch (e) {}
    setParaAttrs_(p, { FONT_SIZE: 8.5, FOREGROUND_COLOR: '#222222' });
    if (spec.chargeType) {
      const tag = p.appendText('   [' + spec.chargeType + ']');
      setTextAttrs_(tag, {
        ITALIC: true,
        FONT_SIZE: 7.5,
        FOREGROUND_COLOR: spec.chargeType === 'Monthly' ? '#0055aa' : '#555555'
      });
    }
    setCellPlain_(c1, String(spec.qty), { ALIGNMENT: DocumentApp.HorizontalAlignment.CENTER });
    setCellPlain_(c2, spec.showPrice ? formatMyr(spec.unitPrice) : '—', { ALIGNMENT: DocumentApp.HorizontalAlignment.RIGHT });
    setCellPlain_(c3, spec.showPrice ? formatMyr(spec.lineTotal) : '—', { ALIGNMENT: DocumentApp.HorizontalAlignment.RIGHT });
    return;
  }
}

// ── Cell helpers ────────────────────────────────────────────────────

function clearCell_(cell) {
  const n = cell.getNumChildren();
  for (let i = 0; i < n; i++) {
    const child = cell.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH) child.clear();
  }
}

function setCellPlain_(cell, text, attrs) {
  clearCell_(cell);
  const p = cell.appendParagraph(text);
  setParaAttrs_(p, Object.assign({ FONT_SIZE: 9, BOLD: false }, attrs || {}));
}

// ── Attribute application ───────────────────────────────────────────
// Apply at the text level for the entire paragraph contents — this is the
// most reliable way to override a template's table-cell normal style.
// Then also at the paragraph level for ALIGNMENT / BACKGROUND_COLOR.
function setParaAttrs_(para, attrs) {
  if (!para || !attrs) return;
  const mapped = mapAttrs_(attrs);
  try {
    const text = para.editAsText();
    const len = text.getText().length;
    if (len > 0) text.setAttributes(0, len - 1, mapped);
    else text.setAttributes(mapped);
  } catch (e) { Logger.log('setParaAttrs (text) failed: ' + e.message); }
  try { para.setAttributes(mapped); }
  catch (e) { Logger.log('setParaAttrs (para) failed: ' + e.message); }
}

function setTextAttrs_(textEl, attrs) {
  if (!textEl || !attrs) return;
  const mapped = mapAttrs_(attrs);
  try { textEl.setAttributes(mapped); }
  catch (e) { Logger.log('setTextAttrs failed: ' + e.message); }
}

function mapAttrs_(attrs) {
  const a = DocumentApp.Attribute;
  const out = {};
  if ('BOLD' in attrs)             out[a.BOLD]                 = attrs.BOLD;
  if ('ITALIC' in attrs)           out[a.ITALIC]               = attrs.ITALIC;
  if ('UNDERLINE' in attrs)        out[a.UNDERLINE]            = attrs.UNDERLINE;
  if ('FONT_SIZE' in attrs)        out[a.FONT_SIZE]            = attrs.FONT_SIZE;
  if ('FOREGROUND_COLOR' in attrs) out[a.FOREGROUND_COLOR]     = attrs.FOREGROUND_COLOR;
  if ('BACKGROUND_COLOR' in attrs) out[a.BACKGROUND_COLOR]     = attrs.BACKGROUND_COLOR;
  if ('ALIGNMENT' in attrs)        out[a.HORIZONTAL_ALIGNMENT] = attrs.ALIGNMENT;
  return out;
}

// ── Charge-group sub-totals ─────────────────────────────────────────
// If only one charge type exists across items, remove the marker row.
// If 2+, replace the marker row with one row per charge type showing total.
function fillChargeGroupRows_(body, payload) {
  const found = body.findText(escRegex_(DOC_CHARGE_GROUPS_MARKER));
  if (!found) return;

  const tableCell = getContainingTableCell_(found.getElement());
  if (!tableCell) {
    body.replaceText(escRegex_(DOC_CHARGE_GROUPS_MARKER), '');
    return;
  }
  const tableRow = tableCell.getParentRow();
  const table = tableRow.getParentTable();
  const markerRowIdx = table.getChildIndex(tableRow);
  const numCols = tableRow.getNumCells();

  const groups = {};
  (payload.items || []).forEach(function(it) {
    const ct = it.chargeType || 'Other';
    groups[ct] = (groups[ct] || 0) + (it.lineTotal || 0);
    (it.subRows || []).filter(function(s) { return s.price > 0; }).forEach(function(sub) {
      const sct = sub.chargeType || 'Other';
      groups[sct] = (groups[sct] || 0) + (sub.price * (it.qty || 1));
    });
    (it.extraPriceRows || []).forEach(function(ep) {
      const ect = ep.chargeType || 'Other';
      groups[ect] = (groups[ect] || 0) + (ep.price * (it.qty || 1));
    });
  });
  const keys = Object.keys(groups);

  if (keys.length <= 1) { table.removeRow(markerRowIdx); return; }

  keys.forEach(function(ct, i) {
    const newRow = table.insertTableRow(markerRowIdx + i);
    while (newRow.getNumCells() < numCols) newRow.appendTableCell('');
    [0, 1, 2, 3].forEach(function(ci) { clearCell_(newRow.getCell(ci)); });
    setCellPlain_(newRow.getCell(2), ct, {
      ALIGNMENT: DocumentApp.HorizontalAlignment.RIGHT,
      FONT_SIZE: 8.5,
      FOREGROUND_COLOR: '#222222'
    });
    setCellPlain_(newRow.getCell(3), 'MYR ' + formatMyr(groups[ct]), {
      ALIGNMENT: DocumentApp.HorizontalAlignment.RIGHT,
      FONT_SIZE: 8.5,
      FOREGROUND_COLOR: '#222222'
    });
  });
  table.removeRow(markerRowIdx + keys.length);
}
