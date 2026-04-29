// ============================================================
// DriveManager.gs — Save PDF to Google Drive folder
// ============================================================

function savePdf(pdfBlob, quoteNumber, customerName, prefix) {
  const folderId = getProp('QUOTATIONS_FOLDER_ID');
  const folder = DriveApp.getFolderById(folderId);

  pdfBlob.setName(buildPdfFileName(quoteNumber, customerName, prefix));

  const file = folder.createFile(pdfBlob);
  // Sharing is inherited from the parent folder — explicit setSharing fails
  // when the executing identity isn't the folder/file owner.

  return { url: file.getUrl(), id: file.getId() };
}
