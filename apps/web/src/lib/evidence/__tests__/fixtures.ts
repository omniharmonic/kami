/**
 * A hand-written JPEG carrying a real EXIF APP1 segment, so the EXIF/GPS tests
 * exercise `exifr` itself rather than a mock. Only the tags the evidence spec
 * needs are written: Make, Model, DateTimeOriginal, and the GPS quartet.
 */

type ExifOptions = {
  make?: string;
  model?: string;
  /** "YYYY:MM:DD HH:MM:SS" (EXIF form, 19 chars) */
  dateTime?: string;
  lat?: number;
  lon?: number;
};

function asciiEntry(tag: number, value: string) {
  return { tag, type: 2, count: value.length + 1, bytes: Buffer.from(`${value}\0`, "ascii") };
}

function rationalsEntry(tag: number, parts: Array<[number, number]>) {
  const bytes = Buffer.alloc(parts.length * 8);
  parts.forEach(([n, d], i) => {
    bytes.writeUInt32BE(n, i * 8);
    bytes.writeUInt32BE(d, i * 8 + 4);
  });
  return { tag, type: 5, count: parts.length, bytes };
}

type Entry = { tag: number; type: number; count: number; bytes: Buffer; inlineLong?: number };

/** Serialise one IFD (big-endian) at `ifdOffset`; data that does not fit inline goes after it. */
function writeIfd(entries: Entry[], ifdOffset: number, nextIfd = 0): { ifd: Buffer; end: number } {
  const dataStart = ifdOffset + 2 + entries.length * 12 + 4;
  const chunks: Buffer[] = [];
  let dataCursor = dataStart;
  const dir = Buffer.alloc(2 + entries.length * 12 + 4);
  dir.writeUInt16BE(entries.length, 0);
  entries.forEach((e, i) => {
    const at = 2 + i * 12;
    dir.writeUInt16BE(e.tag, at);
    dir.writeUInt16BE(e.type, at + 2);
    dir.writeUInt32BE(e.count, at + 4);
    if (e.inlineLong !== undefined) {
      dir.writeUInt32BE(e.inlineLong, at + 8);
    } else if (e.bytes.length <= 4) {
      e.bytes.copy(dir, at + 8);
    } else {
      dir.writeUInt32BE(dataCursor, at + 8);
      chunks.push(e.bytes);
      dataCursor += e.bytes.length;
      if (dataCursor % 2 === 1) {
        chunks.push(Buffer.alloc(1));
        dataCursor += 1;
      }
    }
  });
  dir.writeUInt32BE(nextIfd, 2 + entries.length * 12);
  return { ifd: Buffer.concat([dir, ...chunks]), end: dataCursor };
}

function degToRationals(value: number): Array<[number, number]> {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 100);
  return [
    [deg, 1],
    [min, 1],
    [sec, 100],
  ];
}

/** A 1×1 JPEG whose APP1 segment carries the requested EXIF tags. */
export function buildExifJpeg(opts: ExifOptions = {}): Buffer {
  const { make = "Kami", model = "TestCam", dateTime, lat, lon } = opts;

  // Lay the IFDs out in a fixed order so every pointer is known before writing.
  const exifEntries: Entry[] = dateTime ? [asciiEntry(0x9003, dateTime)] : [];
  const gpsEntries: Entry[] =
    lat !== undefined && lon !== undefined
      ? [
          { ...asciiEntry(0x0001, lat >= 0 ? "N" : "S") },
          rationalsEntry(0x0002, degToRationals(lat)),
          { ...asciiEntry(0x0003, lon >= 0 ? "E" : "W") },
          rationalsEntry(0x0004, degToRationals(lon)),
        ]
      : [];

  const ifd0Entries: Entry[] = [asciiEntry(0x010f, make), asciiEntry(0x0110, model)];
  const hasExif = exifEntries.length > 0;
  const hasGps = gpsEntries.length > 0;
  if (hasExif) ifd0Entries.push({ tag: 0x8769, type: 4, count: 1, bytes: Buffer.alloc(4), inlineLong: 0 });
  if (hasGps) ifd0Entries.push({ tag: 0x8825, type: 4, count: 1, bytes: Buffer.alloc(4), inlineLong: 0 });

  // Pass 1: sizes with placeholder pointers.
  const first = writeIfd(ifd0Entries, 8);
  const exifOffset = first.end;
  const exifBlock = hasExif ? writeIfd(exifEntries, exifOffset) : { ifd: Buffer.alloc(0), end: exifOffset };
  const gpsOffset = exifBlock.end;
  const gpsBlock = hasGps ? writeIfd(gpsEntries, gpsOffset) : { ifd: Buffer.alloc(0), end: gpsOffset };

  // Pass 2: real pointers, same sizes.
  for (const e of ifd0Entries) {
    if (e.tag === 0x8769) e.inlineLong = exifOffset;
    if (e.tag === 0x8825) e.inlineLong = gpsOffset;
  }
  const ifd0 = writeIfd(ifd0Entries, 8).ifd;

  const tiffHeader = Buffer.alloc(8);
  tiffHeader.write("MM", 0, "ascii");
  tiffHeader.writeUInt16BE(0x2a, 2);
  tiffHeader.writeUInt32BE(8, 4);

  const tiff = Buffer.concat([tiffHeader, ifd0, exifBlock.ifd, gpsBlock.ifd]);
  const app1Payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(app1Payload.length + 2, 2);

  // SOI, APP1, then a minimal (structurally sufficient) baseline JPEG body.
  const soi = Buffer.from([0xff, 0xd8]);
  const body = Buffer.from([
    0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(0x10), // DQT
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, // SOF0 1×1
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
    0x00,
    0xff, 0xd9, // EOI
  ]);
  return Buffer.concat([soi, app1, app1Payload, body]);
}

/** A JPEG with no APP1 at all — the "missing EXIF" case. */
export function buildPlainJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(0x10),
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00,
    0xff, 0xd9,
  ]);
}

/** Boulder Creek near Orodell, roughly — the anchor the GPS tests measure from. */
export const ORODELL = { lat: 40.0169, lon: -105.3306 };
