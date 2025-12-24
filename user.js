// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器
// @namespace    https://blog.zhecydn.asia/
// @version      2.3
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
        window.notifyTop = url => window.top.postMessage({ type: 'VIDEO_MSG_V22', url: url }, '*');
    } else {
        window.addEventListener('message', e => {
            if (e.data && e.data.type === 'VIDEO_MSG_V22') addUrl(e.data.url);
        });
    }

    // --- 2. 辅助逻辑 ---
const getResTag = (u) => {
    u = u.toLowerCase();
    if (u.includes('8k') || u.includes('4320')) return '<span style="color:#a55eea;font-weight:bold;">[👑 8K]</span> ';
    if (u.includes('4k') || u.includes('2160')) return '<span style="color:#ff7f50;font-weight:bold;">[💎 4K]</span> ';
    if (u.includes('2k') || u.includes('1440')) return '<span style="color:#45aaf2;font-weight:bold;">[🚀 2K]</span> ';
    if (u.includes('1080') || u.includes('1920') || u.includes('3000k')) return '<span style="color:#ff4757;font-weight:bold;">[🔥 1080P]</span> ';
    if (u.includes('720') || u.includes('1280')) return '<span style="color:#ffa502;">[🌟 720P]</span> ';
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

    // --- 3. 核心嗅探 ---
    function addUrl(url) {
        if (typeof url !== 'string' || !/\.m3u8(\?|$)/i.test(url) || detectedUrls.has(url)) return;
        if (url.startsWith('blob:')) return;
        if (window.self !== window.top) { window.notifyTop(url); return; }

        detectedUrls.add(url);
        if (!panel) createPanel();

        const li = document.createElement('li');
        li.className = 'm3u8-item';
        li.innerHTML = `
            <input type="checkbox" class="checkbox" data-url="${url}">
            <div class="url-content">
                <div class="url-text" title="${url}">${getResTag(url)}${url.split('?')[0].substring(0, 60)}...</div>
                <button class="single-send">${target === 'nas' ? '投喂docker' : '投喂本地'}</button>
            </div>
        `;

        // 核心增强：点击整行（除了投喂按钮）即可切换勾选状态
        li.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON') {
                const cb = li.querySelector('.checkbox');
                cb.checked = !cb.checked;
                li.classList.toggle('selected', cb.checked);
            }
        };

        document.getElementById('m3u8-list').prepend(li);
        const btn = li.querySelector('.single-send');
        btn.onclick = (e) => { e.stopPropagation(); sendTask(url, btn); };
    }

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
        if (btn) { btn.innerText = "✅ 已投喂"; btn.style.opacity = "0.5"; }
    }

    // --- 5. UI 界面 ---
    function createPanel() {
        if (window.self !== window.top || document.getElementById('mediago-panel')) return;
        panel = document.createElement('div');
        panel.id = 'mediago-panel';
        panel.className = theme;
        panel.innerHTML = `
            <div id="p-header">🔍 m3u8资源嗅探器 (MediaGo) <span id="theme-toggle">🌓</span> <span id="set-btn">⚙️</span></div>
            <div class="top-bar"><button id="sel-all">全选</button><button id="batch-btn">批量投喂</button></div>
            <ul id="m3u8-list"></ul>
            <div id="p-footer">
                <div class="ctrl-row">目标: <label><input type="radio" name="target" value="nas" ${target==='nas'?'checked':''}> docker</label> <label><input type="radio" name="target" value="local" ${target==='local'?'checked':''}> 本地</label> <span style="margin-left:10px;">模式:</span> <label><input type="radio" name="mode" value="api" ${mode==='api'?'checked':''}> API</label> <label><input type="radio" name="mode" value="url" ${mode==='url'?'checked':''}> URL</label></div>
                <div class="ctrl-row sub-row">归类: <label><input type="radio" name="folder" value="domain" ${folderType==='domain'?'checked':''}> 域名文件夹</label> <label><input type="radio" name="folder" value="default" ${folderType==='default'?'checked':''}> 默认根目录</label></div>
            </div>
        `;
        GM_addStyle(`
            #mediago-panel { position: fixed !important; top: 20px !important; right: 20px !important; width: 380px !important; max-height: 80vh !important; padding: 12px !important; border-radius: 12px !important; z-index: 2147483647 !important; font-family: sans-serif !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important; display: flex !important; flex-direction: column !important; border: 1px solid rgba(128,128,128,0.3) !important; }
            #mediago-panel.dark { background: rgba(30,30,30,0.95) !important; color: #fff !important; }
            #mediago-panel.light { background: rgba(255,255,255,0.98) !important; color: #111 !important; }
            #p-header { cursor: move !important; padding: 10px !important; background: rgba(128,128,128,0.2) !important; border-radius: 8px !important; font-weight: bold !important; text-align: center !important; font-size: 14px !important; }
            #theme-toggle, #set-btn { float: right !important; cursor: pointer !important; margin-left: 12px !important; }
            .top-bar { display:flex !important; gap:10px !important; padding:10px !important; justify-content:center !important; }
            #sel-all { background:#666 !important; }
            #batch-btn { background:#e67e22 !important; }
            #m3u8-list { list-style: none !important; padding: 0 !important; margin: 10px 0 !important; overflow-y: auto !important; flex: 1 !important; }

            /* 重点：列表项样式加固 */
            .m3u8-item { display: flex !important; align-items: center !important; margin: 8px 0 !important; padding: 10px !important; background: rgba(128,128,128,0.1) !important; border-radius: 8px !important; cursor: pointer !important; transition: all 0.2s !important; border-left: 4px solid #27ae60 !important; }
            .m3u8-item.selected { background: rgba(39, 174, 96, 0.2) !important; border-left: 4px solid #fff !important; }
            .checkbox { margin-right: 12px !important; transform: scale(1.3) !important; cursor: pointer !important; flex-shrink: 0 !important; appearance: checkbox !important; -webkit-appearance: checkbox !important; }
            .url-content { flex: 1 !important; overflow: hidden !important; }

            #mediago-panel button { color: white !important; border: none !important; padding: 5px 12px !important; border-radius: 4px !important; cursor: pointer !important; font-size: 12px !important; font-weight: bold !important; }
            .single-send { background: #27ae60 !important; margin-top: 5px !important; width: 100% !important; }
            .url-text { font-size: 11px !important; word-break: break-all !important; opacity: 0.9 !important; line-height: 1.4 !important; }
            #p-footer { font-size: 11px !important; padding-top: 8px !important; border-top: 1px solid rgba(128,128,128,0.2) !important; }
            .ctrl-row { display: flex !important; align-items: center !important; justify-content: center !important; gap: 8px !important; padding: 4px 0 !important; }
            .sub-row { margin-top: 5px !important; border-top: 1px dashed rgba(128,128,128,0.3) !important; padding-top: 8px !important; }
            #p-footer label { cursor: pointer !important; display: flex !important; align-items: center !important; gap: 3px !important; margin: 0 !important; padding: 0 !important; color: inherit !important; }
            #p-footer input[type="radio"] { appearance: radio !important; -webkit-appearance: radio !important; margin: 0 !important; width: auto !important; height: auto !important; }
        `);
        document.body.appendChild(panel);

        // 交互逻辑... (拖拽, 设置, 全选等逻辑同上，已整合)
        document.getElementById('sel-all').onclick = () => {
            const items = panel.querySelectorAll('.m3u8-item');
            const allChecked = Array.from(items).every(i => i.querySelector('.checkbox').checked);
            items.forEach(i => {
                const cb = i.querySelector('.checkbox');
                cb.checked = !allChecked;
                i.classList.toggle('selected', cb.checked);
            });
        };
        document.getElementById('batch-btn').onclick = () => {
            let selected = Array.from(panel.querySelectorAll('.checkbox:checked')).map(c => c.dataset.url);
            if(selected.length) {
                const prefix = prompt(`批量投喂 ${selected.length} 个任务，前缀:`, document.title);
                if(prefix !== null) selected.forEach((u, i) => setTimeout(() => sendTask(u, null, `${prefix}_批量${i+1}`), i * 500));
            } else { alert('请先勾选需要投喂的链接'); }
        };
        // 拖拽、设置、切换逻辑保留...
        const header = document.getElementById('p-header');
        let isDrag = false, ox, oy;
        header.onmousedown = e => { if(e.target.id==='p-header') { isDrag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; } };
        document.onmousemove = e => { if(isDrag){ panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px'; panel.style.right='auto'; } };
        document.onmouseup = () => isDrag=false;
        document.getElementById('set-btn').onclick = () => {
            let u = prompt('docker 地址:', MEDIAGO_URL);
            if(u){ MEDIAGO_URL = u.trim().replace(/\/+$/, ''); GM_setValue('mediago_url', MEDIAGO_URL); }
        };
        document.getElementById('theme-toggle').onclick = () => {
            theme = (theme === 'dark' ? 'light' : 'dark');
            GM_setValue('theme', theme); panel.className = theme;
        };
        panel.querySelectorAll('input[name="target"]').forEach(r => {
            r.onchange = e => {
                target = e.target.value; GM_setValue('target', target);
                document.querySelectorAll('.single-send').forEach(b => b.innerText = (target==='nas'?'投喂docker':'投喂本地'));
            };
        });
        panel.querySelectorAll('input[name="mode"]').forEach(r => r.onchange = e => { mode = e.target.value; GM_setValue('mode', mode); });
        panel.querySelectorAll('input[name="folder"]').forEach(r => r.onchange = e => { folderType = e.target.value; GM_setValue('folder_type', folderType); });
    }
})();
