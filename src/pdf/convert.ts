/** Convert PDF to Markdown via local sidecar /convert-pdf endpoint. */

export interface PdfConversionResult {
  markdown: string;
  filename: string | null;
}

export async function convertPdfToMarkdown({
  bytes,
  filename,
  baseUrl,
}: {
  bytes: Uint8Array;
  filename: string | null;
  baseUrl: string;
}): Promise<PdfConversionResult> {
  const formData = new FormData();
  const buffer = Buffer.from(bytes);
  const pdfName = filename ?? 'document.pdf';
  const blob = new Blob([buffer], { type: 'application/pdf' });
  formData.append('file', blob, pdfName);

  const response = await fetch(`${baseUrl}/convert-pdf`, { body: formData, method: 'POST' });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PDF conversion failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as { filename?: string; markdown?: string };
  return { filename: data.filename ?? pdfName, markdown: data.markdown ?? '' };
}
