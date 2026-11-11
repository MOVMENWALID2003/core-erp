const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_ENTRY_SIZE = 50 * 1024 * 1024;
const UTF8 = new TextDecoder();

interface ZipEntry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function parseCsv(text: string): Array<Record<string, unknown>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('ملف CSV يحتوي على علامة اقتباس غير مكتملة.');
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('ملف CSV لا يحتوي على صفوف منتجات.');

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, cells[index] ?? '']),
  ));
}

async function inflateRaw(bytes: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  if (expectedSize > MAX_ENTRY_SIZE) throw new Error('يحتوي ملف Excel على بيانات أكبر من الحد المسموح.');
  const compressed = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ENTRY_SIZE) {
      await reader.cancel();
      throw new Error('حجم بيانات Excel بعد فك الضغط يتجاوز الحد المسموح.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return result;
}

function getZipEntries(data: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const minimum = Math.max(0, data.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = data.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('ملف Excel غير صالح أو غير مدعوم.');
  const entryCount = view.getUint16(endOffset + 10, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  const entries = new Map<string, ZipEntry>();
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('بنية ملف Excel غير صالحة.');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > data.byteLength) throw new Error('اسم ملف داخل Excel غير صالح.');
    entries.set(UTF8.decode(data.subarray(nameStart, nameEnd)), {method, compressedSize, uncompressedSize, localOffset});
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

async function readZipEntry(data: Uint8Array, entries: Map<string, ZipEntry>, path: string): Promise<string | undefined> {
  const entry = entries.get(path);
  if (!entry) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = entry.localOffset;
  if (offset + 30 > data.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error('بيانات ورقة Excel غير صالحة.');
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > data.byteLength || entry.uncompressedSize > MAX_ENTRY_SIZE) {
    throw new Error('بيانات ورقة Excel تتجاوز الحد المسموح.');
  }
  const compressed = data.subarray(start, end);
  const decoded = entry.method === 0
    ? compressed
    : entry.method === 8
      ? await inflateRaw(compressed, entry.uncompressedSize)
      : (() => { throw new Error('طريقة ضغط ملف Excel غير مدعومة.'); })();
  return UTF8.decode(decoded);
}

function parseXml(xml: string, label: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error(`تعذر قراءة ${label} في ملف Excel.`);
  return document;
}

function resolveWorkbookPath(target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const segments: string[] = [];
  path.split('/').forEach((segment) => {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  });
  return segments.join('/');
}

async function parseXlsx(data: Uint8Array): Promise<Array<Record<string, unknown>>> {
  const entries = getZipEntries(data);
  const workbookXml = await readZipEntry(data, entries, 'xl/workbook.xml');
  if (!workbookXml) throw new Error('ملف Excel لا يحتوي على مصنف صالح.');
  const workbook = parseXml(workbookXml, 'المصنف');
  const firstSheet = workbook.getElementsByTagNameNS('*', 'sheet').item(0);
  if (!firstSheet) throw new Error('ملف Excel لا يحتوي على أوراق بيانات.');
  const relationshipId = firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (!relationshipId) throw new Error('تعذر تحديد ورقة البيانات في ملف Excel.');

  const relationshipsXml = await readZipEntry(data, entries, 'xl/_rels/workbook.xml.rels');
  if (!relationshipsXml) throw new Error('ملف Excel لا يحتوي على روابط أوراق البيانات.');
  const relationships = parseXml(relationshipsXml, 'روابط المصنف');
  const relationship = [...relationships.getElementsByTagNameNS('*', 'Relationship')]
    .find((item) => item.getAttribute('Id') === relationshipId);
  const target = relationship?.getAttribute('Target');
  if (!target) throw new Error('تعذر فتح ورقة البيانات الأولى.');
  const sheetXml = await readZipEntry(data, entries, resolveWorkbookPath(target));
  if (!sheetXml) throw new Error('ورقة البيانات الأولى غير موجودة في ملف Excel.');
  const worksheet = parseXml(sheetXml, 'ورقة البيانات');
  const stringsXml = await readZipEntry(data, entries, 'xl/sharedStrings.xml');
  const sharedStrings = stringsXml
    ? [...parseXml(stringsXml, 'النصوص المشتركة').getElementsByTagNameNS('*', 'si')]
      .map((item) => [...item.getElementsByTagNameNS('*', 't')].map((text) => text.textContent ?? '').join(''))
    : [];
  const rows = [...worksheet.getElementsByTagNameNS('*', 'row')].map((row) => {
    const cells = new Map<number, string>();
    [...row.getElementsByTagNameNS('*', 'c')].forEach((cell) => {
      const reference = cell.getAttribute('r')?.match(/^[A-Z]+/i)?.[0];
      if (!reference) return;
      const column = [...reference.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const type = cell.getAttribute('t');
      const value = cell.getElementsByTagNameNS('*', 'v').item(0)?.textContent ?? '';
      const text = type === 's'
        ? sharedStrings[Number(value)] ?? ''
        : type === 'inlineStr'
          ? [...cell.getElementsByTagNameNS('*', 't')].map((item) => item.textContent ?? '').join('')
          : value;
      cells.set(column, text);
    });
    return cells;
  }).filter((row) => row.size > 0);

  if (rows.length < 2) throw new Error('ورقة Excel لا تحتوي على صفوف منتجات.');
  const columnCount = Math.max(...[...rows[0].keys()]) + 1;
  const headers = Array.from({length: columnCount}, (_, index) => (rows[0].get(index) ?? '').replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row.get(index) ?? ''])));
}

export async function readProductImportFile(file: File): Promise<Array<Record<string, unknown>>> {
  if (file.size > MAX_FILE_SIZE) throw new Error('حجم الملف يتجاوز الحد المسموح (25 ميجابايت).');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return parseCsv(await file.text());
  if (extension === 'xlsx') return parseXlsx(new Uint8Array(await file.arrayBuffer()));
  throw new Error('صيغة الملف غير مدعومة. اختر CSV أو XLSX.');
}
