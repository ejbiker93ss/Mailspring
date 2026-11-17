const excel = {
  extensions: ['xls', 'xlsx', 'xlsm', 'xlsb'],
  mimeTypes: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroenabled.12',
    'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  ],
};
const csv = { extensions: ['csv'], mimeTypes: ['text/csv', 'application/csv'] };

export const attachmentSearchTypes = {
  excel,
  csv,
  spreadsheet: {
    extensions: [...excel.extensions, ...csv.extensions, 'ods'],
    mimeTypes: [
      ...excel.mimeTypes,
      ...csv.mimeTypes,
      'application/vnd.oasis.opendocument.spreadsheet',
    ],
  },
  pdf: { extensions: ['pdf'], mimeTypes: ['application/pdf'] },
  word: {
    extensions: ['doc', 'docx', 'docm'],
    mimeTypes: [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-word.document.macroenabled.12',
    ],
  },
  powerpoint: {
    extensions: ['ppt', 'pptx', 'pptm', 'pps', 'ppsx'],
    mimeTypes: [
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
      'application/vnd.ms-powerpoint.presentation.macroenabled.12',
    ],
  },
  image: {
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'tiff', 'bmp'],
    mimeTypes: [],
  },
  zip: { extensions: ['zip'], mimeTypes: ['application/zip', 'application/x-zip-compressed'] },
};

export type AttachmentSearchType = keyof typeof attachmentSearchTypes;

export function isAttachmentSearchType(value: string): value is AttachmentSearchType {
  return Object.prototype.hasOwnProperty.call(attachmentSearchTypes, value);
}
