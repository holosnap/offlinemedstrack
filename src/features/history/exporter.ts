import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/** The device-facing pieces of export, behind an interface so logic is testable with a fake. */
export interface FileExporter {
  canShare(): Promise<boolean>;
  /** Writes a text file and returns its URI. */
  writeText(name: string, content: string): Promise<string>;
  /** Renders HTML to a PDF named `name` and returns its URI. */
  htmlToPdf(name: string, html: string): Promise<string>;
  share(uri: string, kind: 'csv' | 'pdf' | 'json', title: string): Promise<void>;
}

const MIME_TYPES = { csv: 'text/csv', pdf: 'application/pdf', json: 'application/json' } as const;
const UTIS = {
  csv: 'public.comma-separated-values-text',
  pdf: 'com.adobe.pdf',
  json: 'public.json',
} as const;

export const expoExporter: FileExporter = {
  canShare: () => Sharing.isAvailableAsync(),

  async writeText(name, content) {
    const file = new FileSystem.File(FileSystem.Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(content);
    return file.uri;
  },

  async htmlToPdf(name, html) {
    const { uri } = await Print.printToFileAsync({ html });
    // The print module picks a random file name; copy to a readable one for the share sheet.
    const target = new FileSystem.File(FileSystem.Paths.cache, name);
    if (target.exists) target.delete();
    new FileSystem.File(uri).copy(target);
    return target.uri;
  },

  async share(uri, kind, title) {
    await Sharing.shareAsync(uri, {
      mimeType: MIME_TYPES[kind],
      UTI: UTIS[kind],
      dialogTitle: title,
    });
  },
};
