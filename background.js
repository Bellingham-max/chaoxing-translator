// 超星学习通翻译 v6 — DeepSeek + 持久缓存 + 单词本

let apiKey = '';
const memCache = new Map();

// ========== 启动时加载缓存 ==========

chrome.storage.local.get({ transCache: {}, key: '' }, d => {
  if (d.key) apiKey = d.key;
  for (const [k, v] of Object.entries(d.transCache || {})) memCache.set(k, v);
});

// ========== DeepSeek 翻译 ==========

async function deepseekTranslate(text) {
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Translate the Chinese text to natural English. Output ONLY the translation. No notes, no quotes, no prefixes. Preserve letter labels (A. B. C. D.), numbers, symbols exactly.' },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error('DeepSeek ' + resp.status);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || text;
}

// ========== 单词释义 ==========

async function defineWord(word) {
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Define this English word in Chinese. Output ONLY: "词性. 中文释义". One short line. Example: "n. 调度算法". Use CS/OS terminology when applicable.' },
        { role: 'user', content: word }
      ],
      temperature: 0, max_tokens: 40,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) return '释义获取失败';
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || '释义获取失败';
}

// ========== 消息处理 ==========

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translate') {
    handleTranslate(msg.texts).then(sendResponse);
    return true;
  }
  if (msg.action === 'defineWord') {
    apiKey = msg.key || apiKey;
    defineWord(msg.word).then(meaning => sendResponse({ meaning }));
    return true;
  }
  if (msg.action === 'setKey') {
    apiKey = msg.key || '';
    chrome.storage.local.set({ key: msg.key || '' });
    sendResponse({ ok: true });
  }
  if (msg.action === 'status') {
    sendResponse({ hasKey: !!apiKey, engine: 'DeepSeek' });
  }
  if (msg.action === 'clearCache') {
    memCache.clear();
    chrome.storage.local.set({ transCache: {} });
    sendResponse({ ok: true });
  }
  if (msg.action === 'getCacheSize') {
    sendResponse({ size: memCache.size });
  }
});

async function handleTranslate(texts) {
  const results = {};
  const toTranslate = [];
  let cached = 0;

  for (const text of texts) {
    const hit = memCache.get(text);
    if (hit !== undefined) { results[text] = hit; cached++; }
    else toTranslate.push(text);
  }

  // Batch: 3 at a time
  for (let i = 0; i < toTranslate.length; i += 3) {
    const batch = toTranslate.slice(i, i + 3);
    const translated = await Promise.all(batch.map(t => translateOne(t)));
    batch.forEach((orig, idx) => {
      results[orig] = translated[idx];
      memCache.set(orig, translated[idx]);
    });
    if (i + 3 < toTranslate.length) await sleep(300);

    // 增量保存到 storage
    const patch = {};
    batch.forEach((orig, idx) => { patch[orig] = translated[idx]; });
    chrome.storage.local.get({ transCache: {} }, d => {
      Object.assign(d.transCache, patch);
      chrome.storage.local.set({ transCache: d.transCache });
    });
  }

  return { results, cached, newTranslated: toTranslate.length };
}

async function translateOne(text, retries = 0) {
  try { return await deepseekTranslate(text); }
  catch (e) {
    if (retries < 1) { await sleep(500); return translateOne(text, retries + 1); }
    return text;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
