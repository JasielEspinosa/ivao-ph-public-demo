/**
 * Standard texts shared by every Data Management page (`*-manage` / `*-listing`).
 * Pass the page's own wording for the record: `singular` ("Country") or `plural` ("Countries").
 */
export const DATA_MANAGE_MESSAGES = {
  loading: (plural: string) => `Loading ${plural}`,
  noRecords: (plural: string) => `No ${plural} found.`,
  unableToLoad: (plural: string) => `Unable to load ${plural}.`,
  added: (singular: string) => `${singular} added successfully.`,
  updated: (singular: string) => `${singular} updated successfully.`,
  deleted: (singular: string) => `${singular} deleted successfully.`,
  confirmDelete: (name: string) =>
    `Are you sure you want to permanently delete "${name}"? This action cannot be undone.`,
  confirmImportReplace: (plural: string, fileName: string) =>
    `This will REPLACE all of the existing ${plural} data with the contents of "${fileName}". Confirm?`,
  exportChoose: 'Choose where to download the data from:',
  uploadingTemplate: 'Uploading template data. Please wait...',
  templateUpdated: 'The template was successfully updated.',
} as const;
