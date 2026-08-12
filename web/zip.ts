/**
 * A minimal zip reader and writer.
 *
 * A project in the editor *is* a directory - the CLI takes one, and the file
 * tabs mirror one exactly. So getting a project out of the browser has to
 * produce a real folder, not a bespoke blob: unzip it and `pulse-ir --outdir`
 * works on it unchanged. Anything else makes the editor and the CLI two
 * separate worlds, which is the fragmentation this project exists to remove.
 *
 * No library, for the same reason as the highlighter: the page must keep
 * working from a file:// URL with nothing installed. Writing a zip needs only
 * CRC-32 and some little-endian headers; reading one needs the browser's own
 * DecompressionStream for entries that a desktop zip tool deflated.
 *
 * Entries are *stored* (uncompressed) on write. A model is a few kilobytes, so
 * compressing it buys nothing and a stored entry is much harder to get wrong.
 */

/** CRC-32, the polynomial zip uses. Table built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Growable little-endian byte buffer. */
class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  bytes(part: Uint8Array): void {
    this.parts.push(part);
    this.length += part.length;
  }

  u16(value: number): void {
    const part = new Uint8Array(2);
    new DataView(part.buffer).setUint16(0, value, true);
    this.bytes(part);
  }

  u32(value: number): void {
    const part = new Uint8Array(4);
    new DataView(part.buffer).setUint32(0, value >>> 0, true);
    this.bytes(part);
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/** MS-DOS packed time and date, which is what a zip header carries. */
function dosStamp(when: Date): { time: number; date: number } {
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    // Years count from 1980, and the format cannot go earlier.
    date: ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/** Names are UTF-8; bit 11 of the flags is how a zip says so. */
const UTF8_NAMES = 0x0800;

/**
 * Build a zip from a map of path to text.
 *
 * Paths may contain `/`, which is how a nested folder is expressed - zip has no
 * directory entries beyond the names themselves.
 */
export function zip(files: Record<string, string>, when: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosStamp(when);
  const out = new Writer();

  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];

  for (const [path, text] of Object.entries(files)) {
    const name = encoder.encode(path);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const offset = out.length;

    out.u32(0x04034b50);      // local file header
    out.u16(20);              // version needed
    out.u16(UTF8_NAMES);
    out.u16(0);               // stored
    out.u16(stamp.time);
    out.u16(stamp.date);
    out.u32(crc);
    out.u32(data.length);     // compressed size == uncompressed, stored
    out.u32(data.length);
    out.u16(name.length);
    out.u16(0);               // no extra field
    out.bytes(name);
    out.bytes(data);

    central.push({ name, crc, size: data.length, offset });
  }

  const centralStart = out.length;

  for (const entry of central) {
    out.u32(0x02014b50);      // central directory header
    out.u16(20);              // version made by
    out.u16(20);              // version needed
    out.u16(UTF8_NAMES);
    out.u16(0);               // stored
    out.u16(stamp.time);
    out.u16(stamp.date);
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.name.length);
    out.u16(0);               // extra
    out.u16(0);               // comment
    out.u16(0);               // disk number
    out.u16(0);               // internal attributes
    out.u32(0);               // external attributes
    out.u32(entry.offset);
    out.bytes(entry.name);
  }

  out.u32(0x06054b50);        // end of central directory
  out.u16(0);                 // this disk
  out.u16(0);                 // disk with the central directory
  out.u16(central.length);
  out.u16(central.length);
  out.u32(out.length - centralStart);
  out.u32(centralStart);
  out.u16(0);                 // no comment

  return out.finish();
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError(
      'This zip is compressed, and this browser cannot decompress it. ' +
      'Re-export it, or import the folder instead of the zip.'
    );
  }

  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a zip into a map of path to bytes.
 *
 * Bytes rather than text: the caller knows which entries are supposed to be
 * text, and decoding a stray binary as UTF-8 would silently corrupt it.
 *
 * Read through the central directory rather than by scanning for local
 * headers. The central directory is the authoritative index, and a scan trips
 * over entries whose sizes live in a trailing data descriptor.
 */
export async function unzip(input: Uint8Array): Promise<Record<string, Uint8Array>> {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);

  // The end-of-central-directory record is last, but a trailing comment can
  // push it back by up to 64k.
  let eocd = -1;
  const earliest = Math.max(0, input.length - 22 - 0xffff);
  for (let at = input.length - 22; at >= earliest; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) throw new ZipError('Not a zip file (no end-of-central-directory record)');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  const files: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (at + 46 > input.length || view.getUint32(at, true) !== 0x02014b50) {
      throw new ZipError(`Damaged zip: central directory entry ${i + 1} is not where it should be`);
    }

    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(input.subarray(at + 46, at + 46 + nameLength));

    at += 46 + nameLength + extraLength + commentLength;

    // A directory is just a name ending in a slash, with no content.
    if (name.endsWith('/')) continue;

    if (view.getUint32(localAt, true) !== 0x04034b50) {
      throw new ZipError(`Damaged zip: "${name}" does not start with a local file header`);
    }

    // The local header's name and extra lengths are authoritative for where
    // the data starts, and may differ from the central directory's.
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const raw = input.subarray(dataAt, dataAt + compressed);

    if (method === 0) {
      files[name] = raw.slice();
    } else if (method === 8) {
      files[name] = await inflateRaw(raw);
    } else {
      throw new ZipError(`"${name}" uses compression method ${method}, which is not supported`);
    }
  }

  return files;
}
