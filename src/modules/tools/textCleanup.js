const CJK_PUNCT = '\u3002\uff01\uff1f\uff1b\uff1a\uff0c\u3001'
const END_PUNCT_RE = new RegExp(`[^${CJK_PUNCT}.!?;:]+[${CJK_PUNCT}.!?;:]?`, 'g')
const EMOJI_RE = /[\u{1f000}-\u{1faff}\u{2600}-\u{27bf}]\ufe0f?/gu
const EMOJI_JOINER_RE = /[\u200d\ufe0e\ufe0f]/g
const TEXT_EMOTE_RE = /[\[【(（]\s*(?:捂脸|笑哭|狗头|吃瓜|流泪|泪目|大哭|哭|笑|哈哈|偷笑|裂开|破防|尴尬|害羞|点赞|鼓掌|玫瑰|爱心|心|火|加油|抱拳|合十|ok|OK)\s*[\]】)）]/g

function stripControl(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\u3000/g, ' ')
}

function stripEmojiNoise(text) {
  return text
    .replace(TEXT_EMOTE_RE, '')
    .replace(EMOJI_RE, '')
    .replace(EMOJI_JOINER_RE, '')
}

function stripTranscriptNoise(text) {
  return text
    .replace(/\[[^\]]{0,30}\]/g, '')
    .replace(/\([^)]{0,20}(?:music|applause|noise|silence|bgm|laugh)[^)]{0,20}\)/gi, '')
    .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*/gm, '')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?\b/g, '')
    .replace(/\b(?:um|uh|er|ah)\b/gi, '')
}

function fixMojibake(text) {
  return text
    .replace(/[�]+/g, '')
    .replace(/(?:é[^\s]{0,3}|æ[^\s]{0,3}|å[^\s]{0,3}|ç[^\s]{0,3}|è[^\s]{0,3}|ã[^\s]{0,3}|â[^\s]{0,3}){3,}/g, '')
}

function normalizeSpacing(text) {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([\u3002\uff01\uff1f\uff1b\uff1a\uff0c\u3001,.!?;:])\s*/g, '$1')
    .replace(/([\u3002\uff01\uff1f\uff1b\uff1a\uff0c\u3001,.!?;:]){2,}/g, '$1')
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, '$1 $2')
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, '$1 $2')
}

function compactRepeatedFragments(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const kept = []
  let prev = ''
  for (const line of lines) {
    if (line === prev) continue
    if (line.length > 8 && prev.includes(line)) continue
    kept.push(line)
    prev = line
  }
  return kept.join('')
}

function splitParagraphs(text, maxLen = 180) {
  const sentences = text.match(END_PUNCT_RE) || [text]
  const paragraphs = []
  let current = ''
  for (const sentence of sentences) {
    const clean = sentence.trim()
    if (!clean) continue
    const next = current ? current + clean : clean
    if (current && next.length > maxLen) {
      paragraphs.push(current)
      current = clean
    } else {
      current = next
    }
  }
  if (current) paragraphs.push(current)
  return paragraphs
}

export function cleanTranscriptText(text) {
  let normalized = String(text || '')
  normalized = stripControl(normalized)
  normalized = stripEmojiNoise(normalized)
  normalized = stripTranscriptNoise(normalized)
  normalized = fixMojibake(normalized)
  normalized = normalizeSpacing(normalized)
  normalized = compactRepeatedFragments(normalized)

  return splitParagraphs(normalized)
    .map(item => item.replace(/^[\u3002\uff01\uff1f\uff1b\uff1a\uff0c\u3001,.!?;:\s]+|[\u3002\uff01\uff1f\uff1b\uff1a\uff0c\u3001,.!?;:\s]+$/g, '').trim())
    .filter(item => item.length > 1)
    .join('\n\n')
}
