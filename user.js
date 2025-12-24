// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器 (优化版 - 支持 Blob & Iframe)
// @namespace    https://blog.zhecydn.asia/
// @version      1.1
// @description  支持blob 链接嗅探 + Iframe 跨域通信 + 批量投喂 + 智能命名
// @author       zhecydn 
// @match        *://*/*
// @allFrames    true
// @run-at       document-start
// @license      MIT
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. 初始化配置 ---
    let MEDIAGO_URL = GM_getValue('mediago_url', '');
    let theme = GM_getValue('theme', 'auto');
    let mode = GM_getValue('mode', 'api');
    let counter = GM_getValue('counter', {});
    let detectedM3u8 = new Set();
    let panel = null;

    // --- 2. 跨页面通信 (针对 Iframe 嵌套) ---
    if (window.self !== window.top) {
        window.notifyTop = function(url) {
            window.top.postMessage({ type: 'M3U8_FOUND_MSG', url: url }, '*');
        };
    } else {
        window.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'M3U8_FOUND_MSG') {
                addM3u8(event.data.url);
            }
        });
    }

    // --- 3. 核心嗅探逻辑 (针对 XHR/Fetch/Blob) ---
    function addM3u8(url) {
        if (typeof url !== 'string') return;
        // 过滤常见的干扰项，匹配 .m3u8 链接
        if (!/\.m3u8(\?|$)/i.test(url) || detectedM3u8.has(url)) return;
        if (url.startsWith('blob:')) return; // blob 链接本身不可下载，我们需要的是它的原始请求

        if (window.self !== window.top) {
            window.notifyTop(url);
            return;
        }

        detectedM3u8.add(url);
        if (!panel) createPanel();

        const li = document.createElement('li');
        li.innerHTML = `
            <input type="checkbox" class="checkbox" data-url="${url}">
            <div class="url-text" title="${url}">${url.split('?')[0].substring(0, 70)}...</div>
            <button class="single-send">投喂 NAS</button>
        `;
        document.getElementById('m3u8-list').prepend(li);
        li.querySelector('.single-send').onclick = () => sendToMediaGo(url);
    }

    // A. 拦截 XMLHttpRequest (最传统且有效的方法)
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        try {
            const fullUrl = new URL(url, location.href).href;
            addM3u8(fullUrl);
        } catch(e) {}
        return origOpen.apply(this, arguments);
    };

    // B. 拦截 Fetch API (现代网页常用)
    const origFetch = window.fetch;
    window.fetch = function(res) {
        let u = typeof res === 'string' ? res : (res && res.url);
        if (u) {
            try { addM3u8(new URL(u, location.href).href); } catch(e) {}
        }
        return origFetch.apply(this, arguments);
    };

    // C. 定时扫描 DOM (兜底方案，防止监听遗漏)
    function scanDom() {
        document.querySelectorAll('video, source, a').forEach(el => {
            const src = el.src || el.getAttribute('src') || el.href;
            if (src && src.includes('.m3u8')) {
                try { addM3u8(new URL(src, location.href).href); } catch(e) {}
            }
        });
    }
    setInterval(scanDom, 3000);

    // --- 4. 投喂逻辑 ---
    function executeSend(url, name) {
        if (!MEDIAGO_URL) return alert('请先点击齿轮设置 MediaGo 地址！');

        if (mode === 'api') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${MEDIAGO_URL}/api/download-now`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ name: name, url: url, type: 'm3u8' }),
                onload: r => {
                    if (r.status >= 200 && r.status < 300) console.log('投喂成功');
                    else alert('API 投喂失败，请检查地址或模式');
                },
                onerror: () => alert('连接 MediaGo 失败')
            });
        } else {
            // URL 模式：支持 Referer 绕过防盗链
            const taskUrl = `${MEDIAGO_URL}/?n=true&name=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}&headers=${encodeURIComponent('Referer:*')}&type=m3u8&silent=true`;
            window.open(taskUrl, '_blank');
        }
    }

    function sendToMediaGo(url) {
        const baseTitle = document.title || '视频任务';
        getSmartName(baseTitle, name => executeSend(url, name));
    }

    function batchSend(urls) {
        const prefix = prompt(`准备投喂 ${urls.length} 个任务，请输入前缀:`, document.title);
        if (prefix === null) return;
        urls.forEach((url, i) => {
            setTimeout(() => executeSend(url, `${prefix}_${i+1}`), i * 500);
        });
    }

    function getSmartName(base, cb) {
        let n = prompt('请输入文件名:', base);
        if (n !== null) {
            let finalName = n.trim() || base;
            if (!counter[base]) counter[base] = 0;
            counter[base]++;
            cb(finalName + (finalName === base ? `_${counter[base]}` : ''));
            GM_setValue('counter', counter);
        }
    }

    // --- 5. UI 界面 (仅在主窗口渲染) ---
    function createPanel() {
        if (window.self !== window.top || document.getElementById('mediago-panel')) return;

        panel = document.createElement('div');
        panel.id = 'mediago-panel';
        panel.innerHTML = `
            <div id="panel-header">
                🔍 资源嗅探器 (MediaGo)
                <span id="theme-toggle" style="float:right;cursor:pointer;margin-left:10px;">🌓</span>
                <span id="settings-btn" style="float:right;cursor:pointer;">⚙️</span>
            </div>
            <div style="display:flex; gap:10px; padding:10px; justify-content:center; border-bottom:1px solid rgba(128,128,128,0.2);">
                <button id="select-all" style="background:#555;">全选</button>
                <button id="batch-send" style="background:#e67e22;">批量投喂</button>
            </div>
            <ul id="m3u8-list"></ul>
            <div id="footer-controls">
                模式: <label><input type="radio" name="mode" value="api" ${mode==='api'?'checked':''}> API</label>
                <label style="margin-left:8px;"><input type="radio" name="mode" value="url" ${mode==='url'?'checked':''}> URL参数</label>
            </div>
        `;

        GM_addStyle(`
            #mediago-panel {
                position: fixed; top: 20px; right: 20px; width: 350px; max-height: 80vh;
                background: var(--mg-bg, #fff); color: var(--mg-text, #000); padding: 12px;
                border-radius: 10px; z-index: 2147483647; font-family: system-ui, sans-serif;
                box-shadow: 0 12px 40px rgba(0,0,0,0.4); border: 1px solid rgba(128,128,128,0.3); overflow: hidden; display: flex; flex-direction: column;
            }
            #panel-header { cursor: move; padding: 10px; background: rgba(128,128,128,0.1); border-radius: 6px; font-weight: bold; margin-bottom: 5px; }
            #m3u8-list { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1; }
            #m3u8-list li { margin: 8px 0; padding: 10px; background: rgba(128,128,128,0.08); border-radius: 8px; position: relative; }
            #footer-controls { margin-top: 10px; padding: 8px; font-size: 12px; text-align: center; border-top: 1px solid rgba(128,128,128,0.2); }
            #mediago-panel button { color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; }
            .single-send { background: #27ae60; margin-top: 5px; }
            .checkbox { position: absolute; top: 12px; left: 8px; transform: scale(1.1); }
            .url-text { margin-left: 28px; font-size: 11px; word-break: break-all; opacity: 0.8; margin-bottom: 5px; }
        `);

        document.body.appendChild(panel);
        applyTheme();

        // 交互绑定
        const header = document.getElementById('panel-header');
        let isDrag = false, ox, oy;
        header.onmousedown = e => { if(e.target.tagName==='SPAN') return; isDrag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; };
        document.onmousemove = e => { if(isDrag){ panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px'; panel.style.right='auto'; } };
        document.onmouseup = () => isDrag=false;

        document.getElementById('settings-btn').onclick = () => {
            let u = prompt('MediaGo 基础地址 (例如 http://192.168.1.5:8080):', MEDIAGO_URL);
            if(u){ MEDIAGO_URL = u.trim().replace(/\/+$/, ''); GM_setValue('mediago_url', MEDIAGO_URL); }
        };
        document.getElementById('theme-toggle').onclick = () => {
            theme = (theme==='dark'?'light':'dark');
            GM_setValue('theme', theme); applyTheme();
        };
        document.getElementById('select-all').onclick = () => {
            let cbs = panel.querySelectorAll('.checkbox');
            let all = Array.from(cbs).every(c => c.checked);
            cbs.forEach(c => c.checked = !all);
        };
        document.getElementById('batch-send').onclick = () => {
            let urls = Array.from(panel.querySelectorAll('.checkbox:checked')).map(c => c.dataset.url);
            if(urls.length) batchSend(urls);
        };
        panel.querySelectorAll('input[name="mode"]').forEach(r => {
            r.onchange = e => { mode = e.target.value; GM_setValue('mode', mode); };
        });
    }

    function applyTheme() {
        const isDark = (theme === 'dark');
        const r = document.documentElement;
        r.style.setProperty('--mg-bg', isDark ? '#1a1a1a' : '#fff');
        r.style.setProperty('--mg-text', isDark ? '#ddd' : '#111');
    }

})();
