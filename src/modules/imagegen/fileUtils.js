export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function stripDataUrl(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '')
}

export function dataUrlToFile(dataUrl, name = 'image.jpg') {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,([\s\S]+)$/)
  if (!match) throw new Error('图片压缩失败')
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], name, { type: match[1] || 'image/jpeg' })
}

export async function compressImageFile(file, options = {}) {
  const maxSide = Number(options.maxSide || 1600)
  const quality = Number(options.quality || 0.82)
  const minQuality = Number(options.minQuality || 0.62)
  const maxBytes = Number(options.maxBytes || 3.5 * 1024 * 1024)
  const always = Boolean(options.always)
  if (!file || !file.type?.startsWith('image/')) return file
  if (!always && file.size <= maxBytes && !/image\/(heic|heif|bmp|tiff)/i.test(file.type)) return file

  const dataUrl = await readFileAsDataUrl(file)
  const img = await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败，无法压缩'))
    image.src = dataUrl
  })

  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height))
  const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale))
  const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, width, height)

  const outputType = 'image/jpeg'
  let nextQuality = quality
  let outputDataUrl = canvas.toDataURL(outputType, nextQuality)
  while (outputDataUrl.length * 0.75 > maxBytes && nextQuality > minQuality) {
    nextQuality = Math.max(minQuality, nextQuality - 0.08)
    outputDataUrl = canvas.toDataURL(outputType, nextQuality)
  }
  const baseName = String(file.name || 'reference').replace(/\.[^.]+$/, '')
  return dataUrlToFile(outputDataUrl, `${baseName}-compressed.jpg`)
}
