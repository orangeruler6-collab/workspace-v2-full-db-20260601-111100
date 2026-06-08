const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const FALLBACK = { category: '待分类', tags: [] };
const TRANSCRIPT_MODEL = 'FunAudioLLM/SenseVoiceSmall';
const VISION_MODEL = process.env.MATERIAL_VISION_MODEL || 'Qwen/Qwen3-VL-30B-A3B-Instruct';

module.exports = function createMaterialClassifier(options) {
  options = options || {};
  const siliconflowKey = options.siliconflowKey || '';
  const callMiniMaxChat = options.callMiniMaxChat;
  console.log('[Classifier] SiliconFlow key loaded:', siliconflowKey ? 'YES (len=' + siliconflowKey.length + ')' : 'NO');
  console.log('[Classifier] Text analyzer loaded:', callMiniMaxChat ? 'YES' : 'NO');

  function cleanTags(tags) {
    const seen = {};
    return (Array.isArray(tags) ? tags : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .filter(item => {
        if (seen[item]) return false;
        seen[item] = true;
        return true;
      })
      .slice(0, 5);
  }

  function normalizeResult(result, source) {
    const category = String(result && result.category || '').trim() || FALLBACK.category;
    const tags = cleanTags(result && result.tags);
    return { category: category, tags: tags, source: source || result && result.source || 'fallback' };
  }

  function parseJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch(e) {}

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch(e) {}
    }

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch(e) {}
    }
    return null;
  }

  function requestJson(hostname, requestPath, payload, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: hostname,
        port: 443,
        path: requestPath,
        method: 'POST',
        headers: headers
      }, res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error('HTTP ' + res.statusCode + ': ' + raw.slice(0, 300)));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch(e) {
            reject(new Error('JSON parse failed: ' + raw.slice(0, 300)));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs || 90000, () => req.destroy(new Error('request timeout')));
      req.write(payload);
      req.end();
    });
  }

  function extractAudio(mediaPath) {
    return new Promise(resolve => {
      const audioPath = path.join(os.tmpdir(), 'material_audio_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.mp3');
      let proc;
      try {
        proc = spawn('ffmpeg', [
          '-y',
          '-i', mediaPath,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-t', '180',
          '-f', 'mp3',
          audioPath
        ]);
      } catch(e) {
        console.log('[Classifier] ffmpeg spawn failed:', e.message);
        resolve('');
        return;
      }
      proc.stderr.on('data', () => {});
      proc.on('error', err => {
        console.log('[Classifier] ffmpeg error:', err.message);
        resolve('');
      });
      proc.on('close', code => {
        try {
          if (code === 0 && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1024) {
            resolve(audioPath);
            return;
          }
          if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        } catch(e) {}
        resolve('');
      });
    });
  }

  async function transcribeMedia(mediaPath) {
    if (!siliconflowKey || !mediaPath || !fs.existsSync(mediaPath)) return '';
    const audioPath = await extractAudio(mediaPath);
    if (!audioPath) return '';

    try {
      const audioBuffer = fs.readFileSync(audioPath);
      const boundary = '----material-classifier-' + Date.now();
      const body = Buffer.concat([
        Buffer.from('--' + boundary + '\r\n' +
          'Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n' +
          'Content-Type: audio/mpeg\r\n\r\n', 'utf8'),
        audioBuffer,
        Buffer.from('\r\n--' + boundary + '\r\n' +
          'Content-Disposition: form-data; name="model"\r\n\r\n' +
          TRANSCRIPT_MODEL + '\r\n' +
          '--' + boundary + '\r\n' +
          'Content-Disposition: form-data; name="language"\r\n\r\n' +
          'auto\r\n' +
          '--' + boundary + '--\r\n', 'utf8')
      ]);

      const json = await requestJson('api.siliconflow.cn', '/v1/audio/transcriptions', body, {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
        'Authorization': 'Bearer ' + siliconflowKey
      }, 120000);

      return String(json.text || json.transcript || '').trim();
    } catch(e) {
      console.log('[Classifier] transcript failed:', e.message);
      return '';
    } finally {
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch(e) {}
    }
  }

  async function classifyByText(input, transcript) {
    if (!callMiniMaxChat) return null;
    const original = input.original || path.basename(input.filePath || '') || 'unknown';
    const meta = input.meta || {};
    const hasTranscript = String(transcript || '').trim().length >= 12;
    const systemPrompt = [
      '你是素材库 AI 元数据助手。',
      '请根据文件名、素材类型、媒体元数据和转写文本，为素材生成一个分类和 3-5 个短标签。',
      '分类要适合素材库检索，例如：口播、剧情、教程、产品、风景、人物、情绪、音乐、音效、图片、待分类。',
      '标签必须短、具体、方便搜索，不要写长句。',
      '只返回严格 JSON，不要解释。格式：{"category":"分类","tags":["标签1","标签2","标签3"]}'
    ].join('\n');
    const userPrompt = [
      '素材类型：' + (input.fileType || 'unknown'),
      '文件名：' + original,
      '时长：' + (meta.duration || input.duration || 0) + ' 秒',
      '尺寸：' + (meta.width || input.width || 0) + 'x' + (meta.height || input.height || 0),
      hasTranscript ? '转写文本：\n' + String(transcript).slice(0, 6000) : '转写文本：无可用文本，请主要根据文件名和元数据判断。',
      '请输出 JSON。'
    ].join('\n');

    try {
      const text = await callMiniMaxChat(systemPrompt, userPrompt, 800, { temperature: 0.2, maxTokens: 800 });
      const parsed = parseJsonObject(text);
      if (!parsed) return null;
      return normalizeResult(parsed, hasTranscript ? 'transcript_text' : 'filename_text');
    } catch(e) {
      console.log('[Classifier] text classify failed:', e.message);
      return null;
    }
  }

  async function classifyByVision(input) {
    const thumbPath = typeof input === 'string' ? input : input.thumbPath;
    if (!siliconflowKey || !thumbPath || !fs.existsSync(thumbPath)) return null;

    try {
      const base64 = fs.readFileSync(thumbPath).toString('base64');
      const payload = JSON.stringify({
        model: VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64 } },
            {
              type: 'text',
              text: '你是素材库 AI 打标签助手。请只根据这张缩略图判断素材分类，并生成 3-5 个短标签。分类要方便检索，例如：人物、场景、产品、剧情、风景、教程、待分类。只返回 JSON：{"category":"分类","tags":["标签1","标签2","标签3"]}'
            }
          ]
        }],
        max_tokens: 800,
        temperature: 0.2
      });

      const json = await requestJson('api.siliconflow.cn', '/v1/chat/completions', payload, {
        'Authorization': 'Bearer ' + siliconflowKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }, 90000);
      const message = json.choices && json.choices[0] && json.choices[0].message;
      const parsed = parseJsonObject(message ? message.content || '' : '');
      if (!parsed) return null;
      return normalizeResult(parsed, 'vision');
    } catch(e) {
      console.log('[Classifier] vision classify failed:', e.message);
      return null;
    }
  }

  async function autoCategory(input) {
    const material = typeof input === 'string' ? { thumbPath: input, fileType: 'image' } : (input || {});
    const fileType = material.fileType || material.type || '';
    let transcript = '';

    try {
      if ((fileType === 'video' || fileType === 'bgm' || fileType === 'audio') && material.filePath) {
        transcript = await transcribeMedia(material.filePath);
      }

      if (transcript.length >= 12 || fileType === 'bgm' || fileType === 'audio' || !material.thumbPath) {
        const textResult = await classifyByText(material, transcript);
        if (textResult && (textResult.category !== FALLBACK.category || textResult.tags.length)) {
          return Object.assign(textResult, {
            transcript_used: transcript.length >= 12,
            transcript_length: transcript.length
          });
        }
      }

      const visionResult = await classifyByVision(material);
      if (visionResult && (visionResult.category !== FALLBACK.category || visionResult.tags.length)) {
        return Object.assign(visionResult, {
          transcript_used: transcript.length >= 12,
          transcript_length: transcript.length
        });
      }

      if (fileType === 'video' || fileType === 'image' || fileType === 'other') {
        const textFallback = await classifyByText(material, transcript);
        if (textFallback && (textFallback.category !== FALLBACK.category || textFallback.tags.length)) {
          return Object.assign(textFallback, {
            transcript_used: transcript.length >= 12,
            transcript_length: transcript.length
          });
        }
      }
    } catch(e) {
      console.log('[Classifier] autoCategory failed:', e.message);
    }

    return Object.assign({}, FALLBACK, {
      source: 'fallback',
      transcript_used: transcript.length >= 12,
      transcript_length: transcript.length
    });
  }

  return {
    autoCategory,
    transcribeMedia,
    classifyByText,
    classifyByVision
  };
};
