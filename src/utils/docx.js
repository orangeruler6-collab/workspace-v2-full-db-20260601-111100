const textEncoder = new TextEncoder()

let crcTable = null

function getCrcTable() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    crcTable[i] = c >>> 0
  }
  return crcTable
}

function crc32(bytes) {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  }
}

function writeU16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true)
}

function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true)
}

function bytesFromString(value) {
  return textEncoder.encode(String(value || ''))
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function localHeader(nameBytes, dataBytes, crc, stamp) {
  const out = new Uint8Array(30 + nameBytes.length)
  const view = new DataView(out.buffer)
  writeU32(view, 0, 0x04034b50)
  writeU16(view, 4, 20)
  writeU16(view, 6, 0x0800)
  writeU16(view, 8, 0)
  writeU16(view, 10, stamp.time)
  writeU16(view, 12, stamp.date)
  writeU32(view, 14, crc)
  writeU32(view, 18, dataBytes.length)
  writeU32(view, 22, dataBytes.length)
  writeU16(view, 26, nameBytes.length)
  writeU16(view, 28, 0)
  out.set(nameBytes, 30)
  return out
}

function centralHeader(nameBytes, dataBytes, crc, stamp, offset) {
  const out = new Uint8Array(46 + nameBytes.length)
  const view = new DataView(out.buffer)
  writeU32(view, 0, 0x02014b50)
  writeU16(view, 4, 20)
  writeU16(view, 6, 20)
  writeU16(view, 8, 0x0800)
  writeU16(view, 10, 0)
  writeU16(view, 12, stamp.time)
  writeU16(view, 14, stamp.date)
  writeU32(view, 16, crc)
  writeU32(view, 20, dataBytes.length)
  writeU32(view, 24, dataBytes.length)
  writeU16(view, 28, nameBytes.length)
  writeU16(view, 30, 0)
  writeU16(view, 32, 0)
  writeU16(view, 34, 0)
  writeU16(view, 36, 0)
  writeU32(view, 38, 0)
  writeU32(view, 42, offset)
  out.set(nameBytes, 46)
  return out
}

function endOfCentralDirectory(fileCount, centralSize, centralOffset) {
  const out = new Uint8Array(22)
  const view = new DataView(out.buffer)
  writeU32(view, 0, 0x06054b50)
  writeU16(view, 4, 0)
  writeU16(view, 6, 0)
  writeU16(view, 8, fileCount)
  writeU16(view, 10, fileCount)
  writeU32(view, 12, centralSize)
  writeU32(view, 16, centralOffset)
  writeU16(view, 20, 0)
  return out
}

function createZip(files) {
  const stamp = dosDateTime()
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const nameBytes = bytesFromString(file.name)
    const dataBytes = file.data instanceof Uint8Array ? file.data : bytesFromString(file.data)
    const crc = crc32(dataBytes)
    const local = localHeader(nameBytes, dataBytes, crc, stamp)
    localParts.push(local, dataBytes)
    centralParts.push(centralHeader(nameBytes, dataBytes, crc, stamp, offset))
    offset += local.length + dataBytes.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  return concatBytes([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory(files.length, centralSize, offset)
  ])
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function docxParagraph(item) {
  const entry = typeof item === 'string' ? { text: item } : (item || {})
  const size = entry.size || 24
  const bold = entry.bold ? '<w:b/>' : ''
  const spacing = entry.spacingAfter === undefined ? 120 : entry.spacingAfter
  const rPr = '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>' + bold + '<w:sz w:val="' + size + '"/></w:rPr>'
  const lines = String(entry.text || '').split(/\r?\n/)
  const runs = lines.map((line, index) => {
    return '<w:r>' + rPr + (index ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + xmlEscape(line) + '</w:t></w:r>'
  }).join('')
  return '<w:p><w:pPr><w:spacing w:after="' + spacing + '"/></w:pPr>' + runs + '</w:p>'
}

function documentXml(paragraphs) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    paragraphs.map(docxParagraph).join(''),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="964" w:right="964" w:bottom="964" w:left="964" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
    '</w:body>',
    '</w:document>'
  ].join('')
}

export function createDocxBlob(paragraphs) {
  const zip = createZip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    },
    {
      name: 'word/document.xml',
      data: documentXml(paragraphs)
    }
  ])
  return new Blob([zip], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })
}
