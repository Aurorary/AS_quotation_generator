// ============================================================
// DriveManager.gs — Save PDF to Google Drive folder
// ============================================================

function savePdf(pdfBlob, quoteNumber) {
  const folderId = getProp('QUOTATIONS_FOLDER_ID');
  const folder = DriveApp.getFolderById(folderId);

  const fileName = quoteNumber.replace(/\//g, '-') + '.pdf';
  pdfBlob.setName(fileName);

  const file = folder.createFile(pdfBlob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return file.getUrl();
}
