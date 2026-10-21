import type { DemoClient } from './client';

// Placeholder documents for the demo, uploaded through the real flow: presign -> PUT to object storage -> confirm.
// They pass the server's checks (allow-list, size, magic bytes) and open in the panel's document viewer.

/** A one-page PDF that names the document and says it is a demo sample. */
export function samplePdf(title: string, owner: string): Buffer {
  const text = `ZOAURO DEMO SAMPLE - ${title} - ${owner} - not a real document`.replace(
    /[()\\]/g,
    ' ',
  );
  const stream = `BT /F1 14 Tf 40 760 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A 1x1 PNG (a kitchen or menu photo stand-in). */
export const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function upload(
  c: DemoClient,
  i: {
    purpose: 'VENDOR_DOC' | 'PARTNER_DOC' | 'MENU_IMAGE';
    zoneId: string;
    entityId: string;
    file: Buffer;
    contentType: 'application/pdf' | 'image/png';
  },
): Promise<string> {
  const p = await c.post<{ uploadUrl: string; fileKey: string }>('/uploads/presign', {
    purpose: i.purpose,
    contentType: i.contentType,
    sizeBytes: i.file.length,
    zoneId: i.zoneId,
    entityId: i.entityId,
  });
  const put = await fetch(p.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': i.contentType },
    body: i.file,
  });
  if (!put.ok) throw new Error(`upload to object storage failed: ${put.status}`);
  await c.post('/uploads/confirm', { fileKey: p.fileKey });
  return p.fileKey;
}
