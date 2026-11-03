import type { FastifyInstance } from 'fastify';

export interface UploadPart {
  filename: string;
  type?: string;
  data: Buffer;
}

/** Build a multipart/form-data body: text fields first (in order), then file parts. */
export function multipart(fields: Record<string, string>, files: UploadPart[]) {
  const boundary = `----fsTest${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.filename}"\r\n` +
      `Content-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`,
    ));
    chunks.push(f.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Upload through the real route. `fields` go first, so conversationId is sent before any file. */
export async function upload(
  app: FastifyInstance, cookie: string, wid: string, conversationId: string, files: UploadPart[],
) {
  const { body, contentType } = multipart({ conversationId }, files);
  const res = await app.inject({
    method: 'POST', url: `/api/w/${wid}/files`,
    headers: { cookie, 'content-type': contentType }, payload: body,
  });
  let json: any = null;
  try { json = res.json(); } catch { json = res.body; }
  return { status: res.statusCode, body: json, headers: res.headers };
}

/** A minimal PNG: signature + IHDR carrying the pixel size (enough for the header probe). */
export function pngBytes(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([sig, ihdr, Buffer.alloc(12)]);
}
