const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const createLogger = require('./logger.cjs');

function loadMiniMaxApiKey(root) {
  var key = process.env.MINIMAX_API_KEY || '';
  try {
    var oc = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
    var providers = (oc.models || {}).providers || {};
    key = key || (providers.minimax || {}).apiKey || '';
  } catch(e) {}
  return key;
}

module.exports = function createLlmRuntime(options) {
  var logger = options.logger || createLogger('llm');
  var sfKey = options.sfKey || '';
  var minimaxApiKey = options.minimaxApiKey || loadMiniMaxApiKey(options.root);
  var openaiApiKey = process.env.FHL_API_KEY || process.env.OPENAI_API_KEY || '';
  var openaiBaseUrl = process.env.FHL_BASE_URL || process.env.OPENAI_BASE_URL || 'https://www.fhl.mom/v1';
  var defaultChatModel = process.env.FHL_DEFAULT_MODEL || process.env.OPENAI_STYLE_MODEL || 'gpt-5.5';
  var fallbackOpenaiApiKey = process.env.FHL_FALLBACK_API_KEY || process.env.OPENAI_FALLBACK_API_KEY || '';
  var fallbackOpenaiBaseUrl = process.env.FHL_FALLBACK_BASE_URL || process.env.OPENAI_FALLBACK_BASE_URL || '';
  var fallbackChatModel = process.env.FHL_FALLBACK_MODEL || process.env.OPENAI_FALLBACK_MODEL || '';
  var proxyUrl = process.env.FHL_PROXY_URL || process.env.MODEL_PROXY_URL || '';
  var proxyAgentPromise = null;

  function normalizeBaseUrl(value) {
    return String(value || 'https://www.fhl.mom/v1').replace(/\/+$/, '');
  }

  function stripThinking(text) {
    return String(text || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function chatPath(base) {
    var parsed = new URL(normalizeBaseUrl(base));
    var pathname = parsed.pathname.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(pathname)) return pathname;
    return (pathname || '') + '/chat/completions';
  }

  function responsesPath(base) {
    var parsed = new URL(normalizeBaseUrl(base));
    var pathname = parsed.pathname.replace(/\/+$/, '');
    if (/\/responses$/.test(pathname)) return pathname;
    if (/\/chat\/completions$/.test(pathname)) return pathname.replace(/\/chat\/completions$/, '/responses');
    return (pathname || '') + '/responses';
  }

  function proxyAgent() {
    if (!proxyUrl) return null;
    if (!proxyAgentPromise) {
      proxyAgentPromise = import('https-proxy-agent').then(function(mod) {
        var Ctor = mod && (mod.HttpsProxyAgent || mod.default);
        return Ctor ? new Ctor(proxyUrl) : null;
      }).catch(function() {
        return null;
      });
    }
    return proxyAgentPromise;
  }

  function modelName(requested) {
    var value = String(requested || '').trim();
    if (!value || value === 'MiniMax' || value === 'MiniMax-M2.7-highspeed') return defaultChatModel;
    if (/kimi/i.test(value)) return process.env.KIMI_MODEL || 'Kimi K2.5';
    if (/gpt[- ]?5\.?5/i.test(value)) return 'gpt-5.5';
    return value;
  }

  function isRetryableModelError(err) {
    var msg = String(err && err.message || err || '');
    var match = msg.match(/model HTTP\s+(\d+)/i);
    if (match) {
      var status = Number(match[1]);
      return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
    }
    return /timeout|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|Remote end closed|UNEXPECTED_EOF|EOF occurred|network socket disconnected/i.test(msg);
  }

  function fallbackEligible(requestOptions) {
    if (requestOptions.apiKey || requestOptions.baseUrl) return false;
    var requested = String(requestOptions.model || '').trim();
    var resolved = modelName(requested);
    if (/kimi/i.test(requested) || /kimi/i.test(resolved)) return false;
    return !requested || /gpt/i.test(requested) || /gpt/i.test(resolved) || requested === 'MiniMax' || requested === 'MiniMax-M2.7-highspeed';
  }

  function providerHost(baseUrl) {
    try { return new URL(normalizeBaseUrl(baseUrl)).hostname; }
    catch(e) { return String(baseUrl || '').replace(/^https?:\/\//, '').split('/')[0]; }
  }

  function extractChatMessageContent(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map(extractChatMessageContent).filter(Boolean).join('\n');
    }
    if (typeof value !== 'object') return '';
    if (typeof value.text === 'string') return value.text;
    if (typeof value.output_text === 'string') return value.output_text;
    if (value.content) return extractChatMessageContent(value.content);
    return '';
  }

  function requestOpenAIProvider(messages, requestOptions) {
    requestOptions = requestOptions || {};
    return new Promise(function(resolve, reject) {
      var apiKey = requestOptions.apiKey || openaiApiKey;
      if (!apiKey) {
        reject(new Error('FHL_API_KEY or OPENAI_API_KEY is not configured'));
        return;
      }

      var base = normalizeBaseUrl(requestOptions.baseUrl || openaiBaseUrl);
      var parsed = new URL(base);
      var body = {
        model: modelName(requestOptions.model),
        messages: messages,
        temperature: requestOptions.temperature === undefined ? 0.7 : requestOptions.temperature
      };
      if (requestOptions.maxOutputTokens !== undefined && requestOptions.maxOutputTokens !== null) {
        body.max_tokens = requestOptions.maxOutputTokens;
      } else if (requestOptions.maxTokens !== undefined && requestOptions.maxTokens !== null) {
        body.max_tokens = requestOptions.maxTokens;
      }
      var payload = JSON.stringify(body);

      var options = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: chatPath(base),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': 'Bearer ' + apiKey
        }
      };
      proxyAgent().then(function(agent) {
        if (agent) options.agent = agent;

        var req = https.request(options, function(res) {
          var data = '';
          res.on('data', function(c) { data += c; });
          res.on('end', function() {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error('model HTTP ' + res.statusCode + ': ' + data.substring(0, 200)));
              return;
            }
            try {
              var json = JSON.parse(data);
              var message = json.choices && json.choices[0] && json.choices[0].message;
              var content = stripThinking(message ? extractChatMessageContent(message.content) : '');
              if (!content && message) {
                logger.warn('model returned empty message content', {
                  model: body.model,
                  finish: json.choices && json.choices[0] && json.choices[0].finish_reason,
                  messagePreview: JSON.stringify(message).slice(0, 800)
                });
              }
              resolve(content);
            } catch(e) {
              reject(new Error('model JSON parse error: ' + data.substring(0, 200)));
            }
          });
        });
        req.on('error', function(e) { reject(e); });
        req.setTimeout(requestOptions.timeoutMs || 120000, function() {
          req.destroy(new Error('model request timeout'));
        });
        req.write(payload);
        req.end();
      }).catch(reject);
    });
  }

  function extractResponseTextValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map(extractResponseTextValue).filter(Boolean).join('\n');
    }
    if (typeof value !== 'object') return '';
    if (typeof value.output_text === 'string') return value.output_text;
    if (typeof value.text === 'string') return value.text;
    if (value.response) return extractResponseTextValue(value.response);
    if (value.item) return extractResponseTextValue(value.item);
    if (value.part) return extractResponseTextValue(value.part);
    if (value.content) return extractResponseTextValue(value.content);
    if (value.output) return extractResponseTextValue(value.output);
    return '';
  }

  function parseResponsesBody(data) {
    try {
      return stripThinking(extractResponseTextValue(JSON.parse(data)));
    } catch(e) {
      throw new Error('responses JSON parse error: ' + String(data || '').substring(0, 200));
    }
  }

  function requestResponsesProvider(messages, requestOptions) {
    requestOptions = requestOptions || {};
    return new Promise(function(resolve, reject) {
      var apiKey = requestOptions.apiKey || openaiApiKey;
      if (!apiKey) {
        reject(new Error('FHL_API_KEY or OPENAI_API_KEY is not configured'));
        return;
      }

      var base = normalizeBaseUrl(requestOptions.baseUrl || openaiBaseUrl);
      var parsed = new URL(base);
      var system = (messages || []).filter(function(message) { return message.role === 'system'; }).map(function(message) { return message.content || ''; }).join('\n\n');
      var input = (messages || []).filter(function(message) { return message.role !== 'system'; }).map(function(message) {
        return { role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content || '' };
      });
      var body = {
        model: modelName(requestOptions.model),
        instructions: system || undefined,
        input: input,
        tools: requestOptions.tools || undefined,
        tool_choice: requestOptions.tools && requestOptions.tools.length ? 'auto' : undefined,
        reasoning: requestOptions.reasoningEffort && requestOptions.reasoningEffort !== 'none' ? { effort: requestOptions.reasoningEffort } : undefined,
        max_output_tokens: requestOptions.maxOutputTokens || requestOptions.maxTokens || undefined,
        store: false
      };
      Object.keys(body).forEach(function(key) {
        if (body[key] === undefined) delete body[key];
      });
      var payload = JSON.stringify(body);

      var options = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: responsesPath(base),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': 'Bearer ' + apiKey
        }
      };
      proxyAgent().then(function(agent) {
        if (agent) options.agent = agent;

        var req = https.request(options, function(res) {
          var data = '';
          res.on('data', function(c) { data += c; });
          res.on('end', function() {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error('responses HTTP ' + res.statusCode + ': ' + data.substring(0, 240)));
              return;
            }
            try {
              resolve(parseResponsesBody(data));
            } catch(e) {
              reject(e);
            }
          });
        });
        req.on('error', function(e) { reject(e); });
        req.setTimeout(requestOptions.timeoutMs || 180000, function() {
          req.destroy(new Error('responses request timeout'));
        });
        req.write(payload);
        req.end();
      }).catch(reject);
    });
  }

  function requestOpenAIProviderStream(messages, requestOptions, handlers) {
    requestOptions = requestOptions || {};
    handlers = handlers || {};
    return new Promise(function(resolve, reject) {
      var apiKey = requestOptions.apiKey || openaiApiKey;
      if (!apiKey) {
        reject(new Error('FHL_API_KEY or OPENAI_API_KEY is not configured'));
        return;
      }

      var base = normalizeBaseUrl(requestOptions.baseUrl || openaiBaseUrl);
      var parsed = new URL(base);
      var body = {
        model: modelName(requestOptions.model),
        messages: messages,
        stream: true,
        temperature: requestOptions.temperature === undefined ? 0.7 : requestOptions.temperature
      };
      if (requestOptions.maxOutputTokens !== undefined && requestOptions.maxOutputTokens !== null) {
        body.max_tokens = requestOptions.maxOutputTokens;
      } else if (requestOptions.maxTokens !== undefined && requestOptions.maxTokens !== null) {
        body.max_tokens = requestOptions.maxTokens;
      }
      var payload = JSON.stringify(body);
      var options = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: chatPath(base),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': 'Bearer ' + apiKey
        }
      };
      proxyAgent().then(function(agent) {
        if (agent) options.agent = agent;

        var accumulated = '';
        var buffer = '';
        var ended = false;
        var gotAnyData = false;
        var req = https.request(options, function(res) {
          var errorBuffer = '';
          res.on('data', function(chunk) {
            var text = chunk.toString('utf8');
            if (res.statusCode < 200 || res.statusCode >= 300) {
              errorBuffer += text;
              return;
            }
            gotAnyData = true;
            buffer += text;
            var blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || '';
            blocks.forEach(function(block) {
              var lines = block.split(/\r?\n/);
              var eventName = 'message';
              var dataLines = [];
              lines.forEach(function(line) {
                if (!line) return;
                if (line.indexOf('event:') === 0) {
                  eventName = line.slice(6).trim();
                  return;
                }
                if (line.indexOf('data:') === 0) {
                  dataLines.push(line.slice(5).trimStart());
                }
              });
              var payloadText = dataLines.join('\n').trim();
              if (!payloadText) return;
              if (payloadText === '[DONE]') {
                if (!ended) {
                  ended = true;
                  var clean = stripThinking(accumulated);
                  if (handlers.onDone) handlers.onDone(clean);
                  resolve(clean);
                }
                return;
              }
              try {
                var json = JSON.parse(payloadText);
                if (handlers.onChunk) handlers.onChunk(json, eventName);
                var delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
                if (delta) {
                  accumulated += delta;
                  if (handlers.onDelta) handlers.onDelta(delta, json);
                }
              } catch (e) {
                if (handlers.onRaw) handlers.onRaw(payloadText, eventName);
              }
            });
          });
          res.on('end', function() {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              var err = new Error('model HTTP ' + res.statusCode + ': ' + errorBuffer.substring(0, 200));
              err.partial = gotAnyData;
              reject(err);
              return;
            }
            if (ended) return;
            ended = true;
            var clean = stripThinking(accumulated);
            if (handlers.onDone) handlers.onDone(clean);
            resolve(clean);
          });
        });
        req.on('error', function(e) {
          e.partial = gotAnyData;
          reject(e);
        });
        req.setTimeout(requestOptions.timeoutMs || 120000, function() {
          var err = new Error('model request timeout');
          err.partial = gotAnyData;
          req.destroy(err);
        });
        req.write(payload);
        req.end();
      }).catch(reject);
    });
  }

  function callOpenAICompatible(messages, requestOptions) {
    requestOptions = requestOptions || {};
    return requestOpenAIProvider(messages, requestOptions).catch(function(err) {
      if (!fallbackOpenaiApiKey || !fallbackOpenaiBaseUrl || !fallbackEligible(requestOptions) || !isRetryableModelError(err)) {
        throw err;
      }
      var fallbackOptions = Object.assign({}, requestOptions, {
        apiKey: fallbackOpenaiApiKey,
        baseUrl: fallbackOpenaiBaseUrl
      });
      if (fallbackChatModel) fallbackOptions.model = fallbackChatModel;
      logger.warn('primary chat provider failed, using fallback', {
        primary: providerHost(openaiBaseUrl),
        fallback: providerHost(fallbackOpenaiBaseUrl),
        error: String(err.message || err).slice(0, 220)
      });
      return requestOpenAIProvider(messages, fallbackOptions).catch(function(fallbackErr) {
        throw new Error(String(err.message || err) + '；fallback failed: ' + String(fallbackErr.message || fallbackErr));
      });
    });
  }

  function callOpenAICompatibleStream(messages, requestOptions, handlers) {
    requestOptions = requestOptions || {};
    return requestOpenAIProviderStream(messages, requestOptions, handlers).catch(function(err) {
      if (!fallbackOpenaiApiKey || !fallbackOpenaiBaseUrl || !fallbackEligible(requestOptions) || !isRetryableModelError(err) || err.partial) {
        throw err;
      }
      var fallbackOptions = Object.assign({}, requestOptions, {
        apiKey: fallbackOpenaiApiKey,
        baseUrl: fallbackOpenaiBaseUrl
      });
      if (fallbackChatModel) fallbackOptions.model = fallbackChatModel;
      logger.warn('primary stream provider failed, using fallback', {
        primary: providerHost(openaiBaseUrl),
        fallback: providerHost(fallbackOpenaiBaseUrl),
        error: String(err.message || err).slice(0, 220)
      });
      return requestOpenAIProviderStream(messages, fallbackOptions, handlers).catch(function(fallbackErr) {
        throw new Error(String(err.message || err) + ' (fallback failed: ' + String(fallbackErr.message || fallbackErr) + ')');
      });
    });
  }

  function callOpenAIChat(systemPrompt, userPrompt, requestOptions) {
    requestOptions = requestOptions || {};
    return callOpenAICompatible([
      { role: 'system', content: systemPrompt || '' },
      { role: 'user', content: userPrompt || '' }
    ], requestOptions);
  }

  function callWebSearchResearch(messages, requestOptions) {
    requestOptions = requestOptions || {};
    return requestResponsesProvider(messages, Object.assign({}, requestOptions, {
      tools: [{ type: 'web_search' }],
      reasoningEffort: requestOptions.reasoningEffort || 'medium',
      maxOutputTokens: requestOptions.maxOutputTokens || requestOptions.maxTokens || 1800,
      timeoutMs: requestOptions.timeoutMs || 180000
    }));
  }

  function callMiniMaxChat(systemPrompt, userPrompt, maxTokens, requestOptions) {
    requestOptions = requestOptions || {};
    requestOptions.maxTokens = maxTokens || requestOptions.maxTokens || 2000;
    return callOpenAIChat(systemPrompt, userPrompt, requestOptions);
  }

  function handleChatRequest(message, history, callback, systemPrompt) {
    var messages = [
      { role: 'system', content: systemPrompt || 'You are a short video operations expert. Reply in Chinese, be concise.' }
    ];
    (history || []).forEach(function(m) {
      messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content || '' });
    });
    messages.push({ role: 'user', content: message || '' });

    callOpenAICompatible(messages, { maxTokens: 2000, temperature: 0.7 }).then(function(reply) {
      callback(null, { reply: reply });
    }).catch(function(err) {
      callback(err, null);
    });
  }

  return {
    callMiniMaxChat: callMiniMaxChat,
    callOpenAIChat: callOpenAIChat,
    callOpenAICompatible: callOpenAICompatible,
    callOpenAICompatibleStream: callOpenAICompatibleStream,
    callWebSearchResearch: callWebSearchResearch,
    callModelText: callOpenAIChat,
    handleChatRequest: handleChatRequest,
    minimaxApiKey: minimaxApiKey,
    openaiApiKey: openaiApiKey,
    siliconflowApiKey: sfKey
  };
};
