// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器
// @namespace    https://blog.zhecydn.asia/
// @version      2.0
// @description  一键投喂M3U8视频资源到 MediaGo（支持 docker 与本地版），具备自动防重名命名、4K/1080P 🔥 标注及文件夹自动整理功能
// @author       zhecydn
// @match        *://*/*
// @allframes    true
// @run-at       document-start
// @license      MIT
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL https://update.greasyfork.org/scripts/559910/M3U8%20%E5%97%85%E6%8E%A2%20%2B%20MediaGo%20%E6%8A%95%E5%96%82%E5%99%A8.user.js
// @updateURL https://update.greasyfork.org/scripts/559910/M3U8%20%E5%97%85%E6%8E%A2%20%2B%20MediaGo%20%E6%8A%95%E5%96%82%E5%99%A8.meta.js
// ==/UserScript==

(function() {
    'use strict';

    let MEDIAGO_URL = GM_getValue('mediago_url', '');
    let theme = GM_getValue('theme', 'dark');
    let mode = GM_getValue('mode', 'api');
    let target = GM_getValue('target', 'nas');
    let folderType = GM_getValue('folder_type', 'domain');
    let counter = GM_getValue('counter', {});
    let detectedUrls = new Set();
    let panel = null;

    // --- 1. 跨页面通信 ---
    if (window.self !== window.top) {
        window.notifyTop = url => window.top.postMessage({ type: 'VIDEO_MSG_V20', url: url }, '*');
    } else {
        window.addEventListener('message', e => {
            if (e.data && e.data.type === 'VIDEO_MSG_V20') addUrl(e.data.url);
        });
    }

    // --- 2. 辅助逻辑 ---
const getResTag = (u) => {
    u = u.toLowerCase();
    // 8K 档
    if (u.includes('8k') || u.includes('4320')) return '<span style="color:#a55eea;font-weight:bold;">[👑 8K]</span> ';
    // 4K 档
    if (u.includes('4k') || u.includes('2160')) return '<span style="color:#ff7f50;font-weight:bold;">[💎 4K]</span> ';
    // 2K / 1440P 档
    if (u.includes('2k') || u.includes('1440')) return '<span style="color:#45aaf2;font-weight:bold;">[🚀 2K]</span> ';
    // 1080P 档
    if (u.includes('1080') || u.includes('1920') || u.includes('3000k')) return '<span style="color:#ff4757;font-weight:bold;">[🔥 1080P]</span> ';
    // 720P 档
    if (u.includes('720') || u.includes('1280')) return '<span style="color:#ffa502;">[🌟 720P]</span> ';
    // 480P 档
    if (u.includes('480') || u.includes('848') || u.includes('800k')) return '<span style="color:#2ed573;">[🍃 480P]</span> ';

    return '';
};

    const getFolder = () => folderType === 'domain' ? location.hostname.split('.')[0] : '';

    const getSmartName = (base) => {
        if (!counter[base]) counter[base] = 0;
        counter[base]++;
        GM_setValue('counter', counter);
        const now = new Date();
        const ts = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
        return `${base}_${counter[base]}_${ts}`;
    };

    // --- 3. 嗅探核心 ---
    function addUrl(url) {
        if (typeof url !== 'string' || !/\.m3u8(\?|$)/i.test(url) || detectedUrls.has(url)) return;
        if (url.startsWith('blob:')) return;
        if (window.self !== window.top) { window.notifyTop(url); return; }

        detectedUrls.add(url);
        if (!panel) createPanel();

        const li = document.createElement('li');
        li.innerHTML = `
            <input type="checkbox" class="checkbox" data-url="${url}">
            <div class="url-text" title="${url}">${getResTag(url)}${url.split('?')[0].substring(0, 60)}...</div>
            <button class="single-send">${target === 'nas' ? '投喂docker' : '投喂本地'}</button>
        `;
        document.getElementById('m3u8-list').prepend(li);
        const btn = li.querySelector('.single-send');
        btn.onclick = () => sendTask(url, btn);
    }

    // A. 拦截 XHR/Fetch
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u) {
        try { addUrl(new URL(u, location.href).href); } catch(e) {}
        return origOpen.apply(this, arguments);
    };
    const origFetch = window.fetch;
    window.fetch = function(res) {
        let u = typeof res === 'string' ? res : (res && res.url);
        if (u) { try { addUrl(new URL(u, location.href).href); } catch(e) {} }
        return origFetch.apply(this, arguments);
    };

    // B. 定时扫描 DOM (补回遗漏的静态扫描)
    setInterval(() => {
        document.querySelectorAll('video, source, a').forEach(el => {
            const src = el.src || el.getAttribute('src') || el.href;
            if (src && src.includes('.m3u8')) {
                try { addUrl(new URL(src, location.href).href); } catch(e) {}
            }
        });
    }, 3000);

    // --- 4. 投喂逻辑 ---
    function sendTask(url, btn, customName = null) {
        const baseTitle = document.title || '视频任务';
        let finalName = "";

        if (customName === null) {
            const n = prompt('确认任务名称:', baseTitle);
            if (n === null) return;
            finalName = getSmartName(n.trim() || baseTitle);
        } else {
            finalName = getSmartName(customName);
        }

        const folder = getFolder();
        const encodedName = encodeURIComponent(finalName);
        const encodedUrl = encodeURIComponent(url);
        const folderParam = folder ? `&folder=${encodeURIComponent(folder)}` : '';

        if (target === 'local') {
            const jump = `mediago://index.html/?n=true&name=${encodedName}&url=${encodedUrl}&headers=Referer%3A*${folderParam}&type=m3u8&silent=true`;
            window.open(jump, '_blank');
        } else {
            if (!MEDIAGO_URL) return alert('请先⚙️设置 mediago docker 地址');
            if (mode === 'api') {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${MEDIAGO_URL}/api/download-now`,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ name: finalName, url: url, type: 'm3u8', folder: folder }),
                    onload: () => console.log('API发送成功')
                });
            } else {
                const jump = `${MEDIAGO_URL}/?n=true&name=${encodedName}&url=${encodedUrl}&headers=Referer%3A*${folderParam}&type=m3u8&silent=true`;
                window.open(jump, '_blank');
            }
        }

        if (btn) {
            btn.innerText = "✅ 已投喂 (可重投)";
            btn.style.opacity = "0.5";
        }
    }

    // --- 5. UI 界面 ---
    function createPanel() {
        if (window.self !== window.top || document.getElementById('mediago-panel')) return;
        panel = document.createElement('div');
        panel.id = 'mediago-panel';
        panel.className = theme;
        panel.innerHTML = `
            <div id="p-header">
                🔍 m3u8资源嗅探器 (MediaGo)
                <span id="theme-toggle" style="float:right;cursor:pointer;margin-left:12px;">🌓</span>
                <span id="set-btn" style="float:right;cursor:pointer;">⚙️</span>
            </div>
            <div class="top-bar">
                <button id="sel-all">全选</button>
                <button id="batch-btn">批量投喂</button>
            </div>
            <ul id="m3u8-list"></ul>
            <div id="p-footer">
                <div class="ctrl-row">
                    目标:
                    <label><input type="radio" name="target" value="nas" ${target==='nas'?'checked':''}> docker</label>
                    <label><input type="radio" name="target" value="local" ${target==='local'?'checked':''}> 本地</label>
                    <span style="margin-left:10px;">模式:</span>
                    <label><input type="radio" name="mode" value="api" ${mode==='api'?'checked':''}> API</label>
                    <label><input type="radio" name="mode" value="url" ${mode==='url'?'checked':''}> URL</label>
                </div>
                <div class="ctrl-row sub-row">
                    归类:
                    <label><input type="radio" name="folder" value="domain" ${folderType==='domain'?'checked':''}> 域名文件夹</label>
                    <label><input type="radio" name="folder" value="default" ${folderType==='default'?'checked':''}> 默认根目录</label>
                </div>
            </div>
        `;
        GM_addStyle(`
            #mediago-panel { position: fixed; top: 20px; right: 20px; width: 380px; max-height: 80vh; padding: 12px; border-radius: 12px; z-index: 2147483647; font-family: sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,0.5); display: flex; flex-direction: column; border: 1px solid rgba(128,128,128,0.3); }
            #mediago-panel.dark { background: rgba(30,30,30,0.95); color: #fff; }
            #mediago-panel.light { background: rgba(255,255,255,0.98); color: #111; }
            #p-header { cursor: move; padding: 10px; background: rgba(128,128,128,0.2); border-radius: 8px; font-weight: bold; text-align: center; font-size: 14px; }
            .top-bar { display:flex; gap:10px; padding:10px; justify-content:center; border-bottom:1px solid rgba(128,128,128,0.2); }
            #sel-all { background:#666; }
            #batch-btn { background:#e67e22; }
            #m3u8-list { list-style: none; padding: 0; margin: 10px 0; overflow-y: auto; flex: 1; }
            #m3u8-list li { margin: 8px 0; padding: 10px; background: rgba(128,128,128,0.1); border-radius: 8px; position: relative; border-left: 4px solid #27ae60; }
            #mediago-panel button { color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; }
            .single-send { background: #27ae60; margin-top: 8px; width: 100%; }
            .url-text { font-size: 11px; word-break: break-all; opacity: 0.9; margin-left: 25px; line-height: 1.4; }
            .checkbox { position: absolute; top: 12px; left: 8px; transform: scale(1.1); }
            #p-footer { font-size: 11px; padding-top: 8px; border-top: 1px solid rgba(128,128,128,0.2); }
            .ctrl-row { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 4px 0; }
            .sub-row { margin-top: 5px; border-top: 1px dashed rgba(128,128,128,0.3); padding-top: 8px; }
            #p-footer label { cursor: pointer; display: flex; align-items: center; gap: 3px; }
        `);
        document.body.appendChild(panel);

        const header = document.getElementById('p-header');
        let isDrag = false, ox, oy;
        header.onmousedown = e => { if(e.target.tagName==='SPAN') return; isDrag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; };
        document.onmousemove = e => { if(isDrag){ panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px'; panel.style.right='auto'; } };
        document.onmouseup = () => isDrag=false;

        document.getElementById('set-btn').onclick = () => {
            let u = prompt('NAS 地址:', MEDIAGO_URL);
            if(u){ MEDIAGO_URL = u.trim().replace(/\/+$/, ''); GM_setValue('mediago_url', MEDIAGO_URL); }
        };
        document.getElementById('theme-toggle').onclick = () => {
            theme = (theme === 'dark' ? 'light' : 'dark');
            GM_setValue('theme', theme); panel.className = theme;
        };

        panel.querySelectorAll('input[name="target"]').forEach(r => {
            r.onchange = e => {
                target = e.target.value; GM_setValue('target', target);
                document.querySelectorAll('.single-send').forEach(b => b.innerText = (target==='nas'?'投喂 docker':'投喂本地'));
            };
        });
        panel.querySelectorAll('input[name="mode"]').forEach(r => {
            r.onchange = e => { mode = e.target.value; GM_setValue('mode', mode); };
        });
        panel.querySelectorAll('input[name="folder"]').forEach(r => {
            r.onchange = e => { folderType = e.target.value; GM_setValue('folder_type', folderType); };
        });

        document.getElementById('sel-all').onclick = () => {
            const cbs = panel.querySelectorAll('.checkbox');
            const all = Array.from(cbs).every(c => c.checked);
            cbs.forEach(c => c.checked = !all);
        };
        document.getElementById('batch-btn').onclick = () => {
            let urls = Array.from(panel.querySelectorAll('.checkbox:checked')).map(c => c.dataset.url);
            if(urls.length) {
                const prefix = prompt(`批量投喂 ${urls.length} 个任务，前缀:`, document.title);
                if(prefix !== null) {
                    urls.forEach((u, i) => setTimeout(() => sendTask(u, null, `${prefix}_批量${i+1}`), i * 500));
                }
            }
        };
    }
})();
