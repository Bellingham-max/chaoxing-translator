// 超星学习通翻译 v6
(function () {
  'use strict';

  // ========== 状态 ==========

  const originals = new Map();
  let translated = false;
  let bilingual = false;
  let deepseekKey = '';
  let courseName = '';

  // ========== API 通信 ==========

  let contextLost = false;

  function call(msg) {
    if (contextLost) return Promise.resolve({});
    return new Promise(r => {
      try {
        chrome.runtime.sendMessage(msg, res => {
          if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message || '';
            if (err.includes('context invalidated') || err.includes('Extension context')) {
              contextLost = true;
              toast('扩展已更新，请刷新页面');
            }
            r({});
          } else {
            r(res || {});
          }
        });
      } catch (e) {
        contextLost = true;
        toast('请刷新页面后使用（扩展已重载）');
        r({});
      }
    });
  }

  // ========== 文本检测 ==========

  function hasChinese(t) { return /[一-鿿]/.test(t); }

  function scan(root) {
    const els = [];
    const add = (el, type) => { const t = el.textContent.trim(); if (t && hasChinese(t) && t.length >= 2) els.push({ el, type }); };
    root.querySelectorAll('h3').forEach(el => { if (hasChinese(el.textContent) && el.textContent.trim().length > 8) add(el, 'q'); });
    root.querySelectorAll('.questionLi li, .TiMu li, .mark_item li').forEach(el => add(el, 'opt'));
    root.querySelectorAll('li').forEach(el => {
      if (/^[A-E][\s\.\、\)）]/.test(el.textContent.trim()) && hasChinese(el.textContent))
        if (el.closest('.questionLi, .TiMu, .mark_item, .singleQuesId') && !els.some(e => e.el === el)) add(el, 'opt');
    });
    root.querySelectorAll('.mark_answer, .answer_detail, .correctAnswer, .myAnswer, .answer, .correct, .explain, [class*="explain"]').forEach(el => {
      if (hasChinese(el.textContent) && el.children.length <= 3) add(el, 'ans');
    });
    root.querySelectorAll('h2').forEach(el => { const t = el.textContent.trim(); if (hasChinese(t) && t.length < 80) add(el, 'sec'); });
    return els;
  }

  function dedup(els) {
    const s = new Set(els.map(e => e.el));
    return els.filter(e => { let p = e.el.parentElement; while (p && p !== document.body) { if (s.has(p)) return false; p = p.parentElement; } return true; });
  }

  // ========== 核心: 翻译 + 还原 + 对照 ==========

  async function doTranslate() {
    if (!deepseekKey) { showSetup(); return; }

    const raw = scan(document.body);
    const items = dedup(raw);
    if (!items.length) { toast('当前页面没有可翻译内容'); return; }

    setTab('loading');

    const m = new Map();
    items.forEach(x => { const t = x.el.textContent.trim(); if (!m.has(t)) m.set(t, []); m.get(t).push(x); });
    const uniq = [...m.keys()];

    const t0 = Date.now();
    const resp = await call({ action: 'translate', texts: uniq });
    const { results, cached } = resp;
    const sec = ((Date.now() - t0) / 1000).toFixed(1);

    // 渲染
    renderAll(m, results);

    translated = true;
    setTab('on');
    showExtras();

    const total = uniq.length;
    if (cached !== undefined) {
      toast('完成 ' + total + ' 条 · ' + cached + ' 缓存 · ' + (total - cached) + ' 新翻 · ' + sec + 's');
    } else {
      toast('完成 ' + total + ' 条 · ' + sec + 's');
    }
  }

  function renderAll(textMap, results) {
    textMap.forEach((xs, orig) => {
      const en = results[orig] || orig;
      xs.forEach(x => {
        if (!x.el.isConnected) return;
        if (!originals.has(x.el)) originals.set(x.el, { text: x.el.textContent, html: x.el.innerHTML });
        applyRender(x.el, en, orig);
      });
    });
  }

  function applyRender(el, en, cn) {
    if (bilingual) {
      el.innerHTML = '<span class="__cx_en">' + esc(en) + '</span><span class="__cx_cn">' + esc(cn) + '</span>';
    } else {
      el.innerHTML = '<span class="__cx_en">' + esc(en) + '</span>';
    }
    el.classList.add('__cx_tr');
  }

  function doRestore() {
    originals.forEach((v, el) => {
      if (el.isConnected) { try { el.innerHTML = v.html; } catch (_) { el.textContent = v.text; } el.classList.remove('__cx_tr'); }
    });
    originals.clear();
    translated = false;
    bilingual = false;
    setTab('off');
    hideExtras();
    toast('已还原');
  }

  function toggleBilingual() {
    bilingual = !bilingual;
    updateBilingualBtn();
    if (translated) {
      // Re-render all
      originals.forEach((v, el) => {
        if (!el.isConnected) return;
        const enEl = el.querySelector('.__cx_en');
        const en = enEl ? enEl.textContent : el.textContent;
        if (bilingual) {
          el.innerHTML = '<span class="__cx_en">' + esc(en) + '</span><span class="__cx_cn">' + esc(v.text) + '</span>';
        } else {
          el.innerHTML = '<span class="__cx_en">' + esc(en) + '</span>';
        }
        el.classList.add('__cx_tr');
      });
    }
    toast(bilingual ? '对照模式已开启' : '对照模式已关闭');
  }

  function doToggle() { translated ? doRestore() : doTranslate(); }

  // ========== 单词本：Ctrl+Click 收藏 ==========

  document.addEventListener('click', async (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (!translated) return;

    // 找到点击的英文词
    const enSpan = e.target.closest('.__cx_en');
    if (!enSpan) return;

    const sel = window.getSelection();
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;

    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent;
    let start = range.startOffset, end = range.startOffset;
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    while (end < text.length && /\w/.test(text[end])) end++;
    const word = text.slice(start, end).trim();

    if (word.length < 2) return;
    if (/^(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|shall|should|may|might|must|can|could|to|of|in|for|on|with|at|by|from|as|into|through|during|before|after|above|below|between|under|and|or|but|not|no|nor|so|yet|both|either|neither|each|every|all|any|few|more|most|other|some|such|only|own|same|than|too|very|just|also|now|then|here|there|when|where|why|how|which|who|whom|whose|what|this|that|these|those|it|its|they|them|their)$/i.test(word)) return;

    e.preventDefault();
    e.stopPropagation();

    // 取原文句子
    const cnSpan = enSpan.parentElement.querySelector('.__cx_cn');
    const context = cnSpan ? cnSpan.textContent : enSpan.textContent;

    toast('查词中: ' + word + '...');

    const resp = await call({ action: 'defineWord', key: deepseekKey, word });
    const meaning = resp.meaning || '释义获取失败';

    // 存到单词本
    chrome.storage.local.get({ vocab: [] }, d => {
      const vocab = d.vocab || [];
      vocab.unshift({
        word: word,
        meaning: meaning,
        context: context.substring(0, 200),
        course: courseName,
        date: new Date().toISOString().slice(0, 10),
      });
      // 最多保留 200 条
      if (vocab.length > 200) vocab.length = 200;
      chrome.storage.local.set({ vocab });
    });

    toast('已收藏: ' + word + ' → ' + meaning);
  });

  // ========== 单词本面板 ==========

  function createVocabPanel() {
    const p = document.createElement('div');
    p.id = '__cx_vocab';
    p.innerHTML = `
      <h4>我的单词本 <button class="clr" id="__cx_vc">清空</button></h4>
      <div id="__cx_vlist"></div>
      <div class="ft">
        <span id="__cx_vcount"></span>
        <button class="exp" id="__cx_vexp">导出 CSV</button>
        <button class="cls" id="__cx_vcls">关闭</button>
      </div>
    `;
    document.body.appendChild(p);

    document.getElementById('__cx_vc').onclick = () => {
      chrome.storage.local.set({ vocab: [] }, () => { loadVocabList(); toast('单词本已清空'); });
    };
    document.getElementById('__cx_vexp').onclick = exportCSV;
    document.getElementById('__cx_vcls').onclick = () => p.style.display = 'none';
    document.addEventListener('click', e => {
      if (p.style.display === 'block' && !p.contains(e.target) && e.target.id !== '__cx_vocab_btn') p.style.display = 'none';
    });
  }

  function showVocabPanel() {
    const p = document.getElementById('__cx_vocab');
    if (!p) { createVocabPanel(); return showVocabPanel(); }
    if (p.style.display === 'block') { p.style.display = 'none'; return; }
    loadVocabList();
    p.style.display = 'block';
  }

  function loadVocabList() {
    chrome.storage.local.get({ vocab: [] }, d => {
      const vocab = d.vocab || [];
      const list = document.getElementById('__cx_vlist');
      const count = document.getElementById('__cx_vcount');
      if (count) count.textContent = '共 ' + vocab.length + ' 个单词';
      if (!list) return;
      if (vocab.length === 0) {
        list.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">还没有收藏单词<br>翻译后 Ctrl+Click 英文词即可收藏</p>';
        return;
      }
      list.innerHTML = vocab.map((v, i) => `
        <div class="card">
          <div class="head">
            <b class="w">${esc(v.word)}</b>
            <span class="m">${esc(v.meaning)}</span>
            <button class="del" data-idx="${i}">×</button>
          </div>
          <div class="ctx">${esc(v.context)}</div>
          <div class="meta">${esc(v.course || '')} · ${esc(v.date || '')}</div>
        </div>
      `).join('');

      // 删除按钮
      list.querySelectorAll('.del').forEach(btn => {
        btn.onclick = () => {
          chrome.storage.local.get({ vocab: [] }, d2 => {
            const v2 = d2.vocab || [];
            v2.splice(parseInt(btn.dataset.idx), 1);
            chrome.storage.local.set({ vocab: v2 }, () => loadVocabList());
          });
        };
      });
    });
  }

  function exportCSV() {
    chrome.storage.local.get({ vocab: [] }, d => {
      const vocab = d.vocab || [];
      let csv = 'Word,Meaning,Context,Course,Date\n';
      vocab.forEach(v => {
        csv += '"' + v.word + '","' + v.meaning + '","' + v.context + '","' + (v.course || '') + '","' + (v.date || '') + '"\n';
      });
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'chaoxing_vocab.csv'; a.click();
      URL.revokeObjectURL(url);
      toast('已导出 CSV');
    });
  }

  // ========== UI 组件 ==========

  function setTab(state) {
    const tab = document.getElementById('__cx_tab');
    const label = document.getElementById('__cx_label');
    if (!tab || !label) return;
    tab.className = '__cx_tab __cx_' + state;
    label.textContent = { off: '翻译', on: '还原', loading: '· · ·' }[state] || '翻译';
  }

  function showExtras() {
    document.getElementById('__cx_bi').style.display = 'block';
    document.getElementById('__cx_vocab_btn').style.display = 'block';
    updateBilingualBtn();
  }

  function hideExtras() {
    document.getElementById('__cx_bi').style.display = 'none';
    document.getElementById('__cx_vocab_btn').style.display = 'none';
    updateBilingualBtn();
  }

  function updateBilingualBtn() {
    const btn = document.getElementById('__cx_bi');
    if (btn) btn.textContent = bilingual ? '对照 ✓' : '对照';
  }

  function createUI() {
    const wrap = document.createElement('div');
    wrap.id = '__cx_wrap';
    wrap.innerHTML = `
      <div id="__cx_tab" class="__cx_tab __cx_off" title="翻译为英文 · Ctrl+Shift+T">
        <div id="__cx_inner"><span id="__cx_label">翻译</span></div>
        <span id="__cx_dot"></span>
      </div>
      <div id="__cx_bi" class="__cx_extra_btn">对照</div>
      <div id="__cx_vocab_btn" class="__cx_extra_btn">单词本</div>
      <div id="__cx_info">
        <span id="__cx_name">DeepSeek</span>
        <span id="__cx_gear" title="设置">⚙</span>
      </div>
    `;
    document.body.appendChild(wrap);

    // 事件
    document.getElementById('__cx_tab').addEventListener('click', doToggle);
    document.getElementById('__cx_bi').addEventListener('click', toggleBilingual);
    document.getElementById('__cx_vocab_btn').addEventListener('click', showVocabPanel);
    document.getElementById('__cx_gear').addEventListener('click', showSetup);

    // 获取课程名
    courseName = extractCourseName();

    // 加载 key
    chrome.storage.local.get({ key: '' }, d => {
      deepseekKey = d.key || '';
      updateBadge();
      if (!deepseekKey) setTimeout(showSetup, 500);
    });
  }

  function extractCourseName() {
    const h2 = document.querySelector('h2');
    if (h2) return h2.textContent.trim();
    const title = document.querySelector('head title');
    if (title) {
      const t = title.textContent;
      const m = t.match(/^(.+?)(?:\s*\(|（|202|课程|$)/);
      if (m) return m[1].trim();
      return t.replace(/作业详情|考试|学习通|超星/g, '').trim();
    }
    return '';
  }

  function updateBadge() {
    const name = document.getElementById('__cx_name');
    if (name) name.childNodes[0].textContent = deepseekKey ? 'DeepSeek' : '待配Key';
  }

  // ========== 设置面板 ==========

  function createSetup() {
    const p = document.createElement('div');
    p.id = '__cx_setup';
    p.innerHTML = `
      <h4>配置 DeepSeek API</h4>
      <p class="desc">DeepSeek AI 翻译，学术术语准确，翻译质量远超传统工具。</p>
      <label>API Key</label>
      <input id="__cx_keyin" type="password" placeholder="sk-...">
      <div class="btns">
        <button class="s" id="__cx_save">保存并开始翻译</button>
        <button class="g" id="__cx_clear">清空翻译缓存</button>
      </div>
      <p class="link">还没有 Key？<a href="https://platform.deepseek.com/api_keys" target="_blank">点击获取 →</a>（新用户送免费额度）</p>
    `;
    document.body.appendChild(p);

    document.getElementById('__cx_save').onclick = async () => {
      const key = document.getElementById('__cx_keyin').value.trim();
      if (!key) { toast('请粘贴 DeepSeek API Key'); return; }
      deepseekKey = key;
      chrome.storage.local.set({ key });
      await call({ action: 'setKey', key });
      p.style.display = 'none';
      updateBadge();
      toast('DeepSeek 已就绪');
      doTranslate();
    };

    document.getElementById('__cx_clear').onclick = async () => {
      await call({ action: 'clearCache' });
      toast('翻译缓存已清空');
    };

    document.addEventListener('click', e => {
      if (p.style.display === 'block' && !p.contains(e.target) && !e.target.closest('#__cx_gear')) p.style.display = 'none';
    });
  }

  function showSetup() {
    const p = document.getElementById('__cx_setup');
    if (!p) { createSetup(); return showSetup(); }
    chrome.storage.local.get({ key: '' }, d => { document.getElementById('__cx_keyin').value = d.key || ''; });
    call({ action: 'getCacheSize' }).then(r => {
      const hint = document.querySelector('#__cx_setup .link');
      if (hint && r.size) hint.textContent = '缓存 ' + r.size + ' 条翻译 · 还没有 Key？点击获取 →';
    });
    p.style.display = 'block';
  }

  // ========== Toast ==========

  function toast(msg) {
    let e = document.getElementById('__cx_toast');
    if (!e) {
      e = document.createElement('div'); e.id = '__cx_toast';
      e.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(30,30,30,.9);color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;opacity:0;transition:opacity .35s;pointer-events:none;font-family:"Microsoft YaHei","PingFang SC",sans-serif;backdrop-filter:blur(8px);white-space:nowrap;';
      document.body.appendChild(e);
    }
    e.textContent = msg; e.style.opacity = '1';
    clearTimeout(e._t); e._t = setTimeout(() => e.style.opacity = '0', 2500);
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ========== 快捷键 ==========

  function setupKB() {
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); doToggle(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'B') { e.preventDefault(); toggleBilingual(); }
    });
  }

  // ========== SPA 导航 ==========

  let lastUrl = location.href;
  function setupNav() {
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        originals.clear(); translated = false; bilingual = false;
        setTab('off'); hideExtras();
        courseName = extractCourseName();
        chrome.storage.local.get({ key: '' }, d => {
          deepseekKey = d.key || '';
          if (deepseekKey) call({ action: 'setKey', key: deepseekKey });
          updateBadge();
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
    ['pushState', 'replaceState'].forEach(m => { const o = history[m]; history[m] = function () { o.apply(this, arguments); lastUrl = location.href; }; });
  }

  // ========== CSS ==========

  function injectCSS() {
    const s = document.createElement('style');
    s.textContent = `
      #__cx_wrap {
        position:fixed;top:42%;right:0;z-index:2147483646;
        display:flex;flex-direction:column;align-items:flex-end;gap:6px;
        font-family:"Microsoft YaHei","PingFang SC",sans-serif;
        transform:translateY(-70px);
      }
      #__cx_tab {
        width:30px;height:88px;border-radius:10px 0 0 10px;
        cursor:pointer;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:6px;
        transition:all .3s ease;user-select:none;
        box-shadow:-2px 2px 12px rgba(0,0,0,.12);
      }
      #__cx_tab:hover { width:34px;box-shadow:-4px 4px 20px rgba(0,0,0,.2); }
      #__cx_inner { display:flex;align-items:center;justify-content:center; }
      #__cx_label { writing-mode:vertical-rl;color:#fff;font-size:13px;font-weight:700;letter-spacing:3px; }
      #__cx_dot { width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.5); }
      .__cx_off { background:linear-gradient(180deg,#4285f4,#1a73e8); }
      .__cx_on { background:linear-gradient(180deg,#1a1a2e,#16213e); }
      .__cx_loading { background:linear-gradient(180deg,#4a9eff,#2563eb);animation:__cx_pulse .8s ease-in-out infinite; }
      @keyframes __cx_pulse { 0%,100%{opacity:1} 50%{opacity:.6} }

      .__cx_extra_btn {
        display:none;font-size:11px;color:#89b4fa;cursor:pointer;
        font-weight:600;user-select:none;padding:4px 8px;
        border-radius:8px;transition:all .2s;
        background:rgba(137,180,250,.08);
      }
      .__cx_extra_btn:hover { background:rgba(137,180,250,.18); }

      #__cx_info { font-size:9px;color:#999;text-align:center;white-space:nowrap; }
      #__cx_gear { cursor:pointer;opacity:.6;transition:opacity .2s; }
      #__cx_gear:hover { opacity:1; }

      /* 双语 */
      .__cx_tr { display:block; }
      .__cx_en { display:block; }
      .__cx_cn { display:block;color:#aaa;font-size:.85em;margin-top:2px; }

      /* 设置 */
      #__cx_setup {
        position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;
        background:#1e1e2e;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);
        padding:28px;width:360px;display:none;
        font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#cdd6f4;
      }
      #__cx_setup h4 { margin:0 0 8px 0;font-size:18px;color:#fff; }
      #__cx_setup .desc { margin:0 0 20px;font-size:13px;color:#a6adc8;line-height:1.6; }
      #__cx_setup label { display:block;margin-bottom:6px;color:#bac2de;font-size:12px;font-weight:600; }
      #__cx_setup input {
        width:100%;padding:12px 14px;border:1px solid #313244;border-radius:10px;
        font-size:13px;box-sizing:border-box;font-family:monospace;
        background:#313244;color:#cdd6f4;
      }
      #__cx_setup input:focus { outline:none;border-color:#89b4fa; }
      #__cx_setup input::placeholder { color:#585b70; }
      #__cx_setup .btns { display:flex;gap:8px;margin-top:16px; }
      #__cx_setup .btns button { flex:1;padding:12px;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600; }
      #__cx_setup .s { background:linear-gradient(135deg,#89b4fa,#4a9eff);color:#1e1e2e; }
      #__cx_setup .g { background:#313244;color:#a6adc8;font-size:12px; }
      #__cx_setup .link { margin-top:14px;font-size:11px;color:#6c7086;text-align:center; }
      #__cx_setup .link a { color:#89b4fa;text-decoration:none; }

      /* 单词本 */
      #__cx_vocab {
        position:fixed;top:8%;right:52px;z-index:2147483647;
        background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.18);
        padding:20px;width:340px;max-height:80vh;overflow-y:auto;display:none;
        font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:13px;
      }
      #__cx_vocab h4 { margin:0 0 14px 0;font-size:15px;color:#333;display:flex;justify-content:space-between;align-items:center; }
      #__cx_vocab .clr { font-size:11px;background:none;border:1px solid #ddd;border-radius:6px;cursor:pointer;padding:4px 10px;color:#999; }
      #__cx_vocab .card {
        background:#f8f9fa;border-radius:10px;padding:12px;margin-bottom:8px;
        border-left:3px solid #89b4fa;
      }
      #__cx_vocab .head { display:flex;align-items:center;gap:8px;margin-bottom:4px; }
      #__cx_vocab .w { color:#1a73e8; }
      #__cx_vocab .m { color:#666;font-size:12px; }
      #__cx_vocab .del { margin-left:auto;background:none;border:none;color:#ccc;cursor:pointer;font-size:16px; }
      #__cx_vocab .del:hover { color:#ea4335; }
      #__cx_vocab .ctx { color:#999;font-size:11px;line-height:1.4;margin:4px 0; }
      #__cx_vocab .meta { color:#ccc;font-size:10px; }
      #__cx_vocab .ft { display:flex;align-items:center;gap:8px;margin-top:12px;justify-content:flex-end; }
      #__cx_vocab .ft button { padding:8px 14px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600; }
      #__cx_vocab .exp { background:#f0f0f0;color:#666; }
      #__cx_vocab .cls { background:#4285f4;color:#fff; }
      #__cx_vcount { color:#999;font-size:11px;margin-right:auto; }

      /* Toast */
      #__cx_toast { animation:__cx_fade .3s ease; }
      @keyframes __cx_fade { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
    `;
    document.head.appendChild(s);
  }

  // ========== 启动 ==========

  function init() {
    if (!document.body) { setTimeout(init, 200); return; }
    if (location.href.includes('/login') || location.href.includes('/passport')) return;

    injectCSS();
    createUI();
    createSetup();
    createVocabPanel();
    setupKB();
    setupNav();

    chrome.storage.local.get({ key: '' }, d => {
      deepseekKey = d.key || '';
      if (deepseekKey) call({ action: 'setKey', key: deepseekKey });
    });
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
