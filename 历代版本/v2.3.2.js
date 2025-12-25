
// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器 (v2.3.2 稳健加固版)，这个版本最稳定，目前没问题
// @namespace    https://blog.zhecydn.asia/
// @version      2.3.2
// @description  基于2.3.1修复拖拽记忆功能 | 保留完美隔离样式 | 新增B站直投逻辑 | 自动防重名命名
// @author       zhecydn
// @match        *://*/*
// @allframes    true
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    let MEDIAGO_URL = GM_getValue('mediago_url', '');
    let theme = GM_getValue('theme', 'dark');
    let mode = GM_getValue('mode', 'api');
    let target = GM_getValue('target', 'nas');
    let folderType = GM_getValue('folder_type', 'domain');
    let counter = GM_getValue('counter', {});

    // --- 面板位置记忆读取 ---
    let savedPos = GM_getValue('panel_pos', { top: '20px', left: 'auto', right: '20px' });

    let detectedUrls = new Set();
    let panel = null;

    // 如果是 B 站，直接初始化面板
    if (location.hostname.includes('bilibili.com')) {
        window.addEventListener('DOMContentLoaded', () => {
            if (!panel) createPanel();
        });
    }

    // --- 1. 跨页面通信 ---
    if (window.self !== window.top) {
        window.notifyTop = url => window.top.postMessage({ type: 'VIDEO_MSG_V232', url: url }, '*');
    } else {
        window.addEventListener('message', e => {
            if (e.data && e.data.type === 'VIDEO_MSG_V232') addUrl(e.data.url);
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

    // --- 3. 嗅探核心 ---
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

        li.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON') {
                const cb = li.querySelector('.checkbox');
                cb.checked = !cb.checked;
                li.classList.toggle('selected', cb.checked);
            }
        };

        document.getElementById('m3u8-list').prepend(li);
        const btn = li.querySelector('.single-send');
        btn.onclick = (e) => {
            e.stopPropagation();
            sendTask(url, btn);
        };
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
        const isBili = url.includes('bilibili.com');
        const finalType = isBili ? 'bilibili' : 'm3u8';

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
            const jump = `mediago://index.html/?n=true&name=${encodedName}&url=${encodedUrl}&headers=Referer%3A*${folderParam}&type=${finalType}&silent=true`;
            window.open(jump, '_blank');
        } else {
            if (!MEDIAGO_URL) return alert('请先⚙️设置 mediago docker 地址');
            if (mode === 'api') {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${MEDIAGO_URL}/api/download-now`,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ name: finalName, url: url, type: finalType, folder: folder }),
                    onload: () => console.log('API发送成功')
                });
            } else {
                const jump = `${MEDIAGO_URL}/?n=true&name=${encodedName}&url=${encodedUrl}&headers=Referer%3A*${folderParam}&type=${finalType}&silent=true`;
                window.open(jump, '_blank');
            }
        }

        if (btn) {
            btn.innerText = "✅ 已投喂";
            btn.style.opacity = "0.5";
        }
    }

    // --- 5. UI 界面 ---
    function createPanel() {
        if (window.self !== window.top || document.getElementById('mediago-panel')) return;
        panel = document.createElement('div');
        panel.id = 'mediago-panel';
        panel.className = theme;

        // --- 应用保存过的位置 ---
        panel.style.top = savedPos.top;
        panel.style.left = savedPos.left;
        panel.style.right = savedPos.right;

        const isBiliPage = location.hostname.includes('bilibili.com');

        panel.innerHTML = `
            <div id="p-header">🔍 m3u8资源嗅探器 (MediaGo) <span id="theme-toggle" style="float:right;cursor:pointer;margin-left:12px;">🌓</span><span id="set-btn" style="float:right;cursor:pointer;">⚙️</span></div>
            <div class="top-bar">
                <button id="sel-all">全选</button>
                ${isBiliPage ? '<button id="bili-direct-btn" style="background:#fb7299 !important;">🚀 投喂B站直链</button>' : ''}
                <button id="batch-btn">批量投喂</button>
            </div>
            <ul id="m3u8-list"></ul>
            <div id="p-footer">
                <div class="ctrl-row">目标: <label><input type="radio" name="target" value="nas" ${target==='nas'?'checked':''}> docker</label> <label><input type="radio" name="target" value="local" ${target==='local'?'checked':''}> 本地</label> <span style="margin-left:10px;">模式:</span> <label><input type="radio" name="mode" value="api" ${mode==='api'?'checked':''}> API</label> <label><input type="radio" name="mode" value="url" ${mode==='url'?'checked':''}> URL</label></div>
                <div class="ctrl-row sub-row">归类: <label><input type="radio" name="folder" value="domain" ${folderType==='domain'?'checked':''}> 域名文件夹</label> <label><input type="radio" name="folder" value="default" ${folderType==='default'?'checked':''}> 默认根目录</label></div>
            </div>
        `;
        GM_addStyle(`
            #mediago-panel { position: fixed !important; width: 380px !important; max-height: 80vh !important; padding: 12px !important; border-radius: 12px !important; z-index: 2147483647 !important; font-family: sans-serif !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important; display: flex !important; flex-direction: column !important; border: 1px solid rgba(128,128,128,0.3) !important; }
            #mediago-panel.dark { background: rgba(30,30,30,0.95) !important; color: #fff !important; }
            #mediago-panel.light { background: rgba(255,255,255,0.98) !important; color: #111 !important; }
            #p-header { cursor: move !important; padding: 10px !important; background: rgba(128,128,128,0.2) !important; border-radius: 8px !important; font-weight: bold !important; text-align: center !important; font-size: 14px !important; }
            .top-bar { display:flex !important; gap:8px !important; padding:10px !important; justify-content:center !important; border-bottom:1px solid rgba(128,128,128,0.2) !important; }
            #sel-all { background:#666 !important; }
            #batch-btn { background:#e67e22 !important; }
            #m3u8-list { list-style: none !important; padding: 0 !important; margin: 10px 0 !important; overflow-y: auto !important; flex: 1 !important; }
            .m3u8-item { display: flex !important; align-items: center !important; margin: 8px 0 !important; padding: 10px !important; background: rgba(128,128,128,0.1) !important; border-radius: 8px !important; cursor: pointer !important; position: relative !important; border-left: 4px solid #27ae60 !important; }
            .m3u8-item.selected { background: rgba(39, 174, 96, 0.2) !important; }
            .checkbox { margin-right: 12px !important; transform: scale(1.2) !important; flex-shrink: 0 !important; appearance: checkbox !important; -webkit-appearance: checkbox !important; }
            .url-content { flex: 1 !important; min-width: 0 !important; }
            #mediago-panel button { color: white !important; border: none !important; padding: 5px 12px !important; border-radius: 4px !important; cursor: pointer !important; font-size: 12px !important; font-weight: bold !important; }
            .single-send { background: #27ae60 !important; margin-top: 8px !important; width: 100% !important; }
            .url-text { font-size: 11px !important; word-break: break-all !important; opacity: 0.9 !important; line-height: 1.4 !important; }
            #p-footer { font-size: 11px !important; padding-top: 8px !important; border-top: 1px solid rgba(128,128,128,0.2) !important; }
            .ctrl-row { display: flex !important; align-items: center !important; justify-content: center !important; gap: 8px !important; padding: 4px 0 !important; }
            .sub-row { margin-top: 5px !important; border-top: 1px dashed rgba(128,128,128,0.3) !important; padding-top: 8px !important; }
            #p-footer label { cursor: pointer !important; display: flex !important; align-items: center !important; gap: 3px !important; margin: 0 !important; padding: 0 !important; color: inherit !important; }
            #p-footer input[type="radio"] { appearance: radio !important; -webkit-appearance: radio !important; margin: 0 !important; width: auto !important; height: auto !important; }
        `);
        document.body.appendChild(panel);

        if (isBiliPage) {
            document.getElementById('bili-direct-btn').onclick = () => {
                sendTask(location.href.split('?')[0], null, document.title.split('_')[0]);
            };
        }

        // --- v2.3.2 修复：全方位拖拽 + 记忆 ---
        const header = document.getElementById('p-header');
        let isDrag = false, ox, oy;
        header.onmousedown = e => { if(e.target.tagName==='SPAN') return; isDrag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; };
        document.onmousemove = e => {
            if(isDrag){
                panel.style.left=(e.clientX-ox)+'px';
                panel.style.top=(e.clientY-oy)+'px';
                panel.style.right='auto';
            }
        };
        document.onmouseup = () => {
            if(isDrag) {
                isDrag = false;
                GM_setValue('panel_pos', { top: panel.style.top, left: panel.style.left, right: 'auto' });
            }
        };

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
            const items = panel.querySelectorAll('.m3u8-item');
            const allChecked = Array.from(items).every(item => item.querySelector('.checkbox').checked);
            items.forEach(item => {
                const cb = item.querySelector('.checkbox');
                cb.checked = !allChecked;
                item.classList.toggle('selected', !allChecked);
            });
        };
        document.getElementById('batch-btn').onclick = () => {
            let urls = Array.from(panel.querySelectorAll('.checkbox:checked')).map(c => c.dataset.url);
            if(urls.length) {
                const prefix = prompt(`批量投喂 ${urls.length} 个任务，前缀:`, document.title);
                if(prefix !== null) {
                    urls.forEach((u, i) => setTimeout(() => sendTask(u, null, `${prefix}_批量${i+1}`), i * 500));
                }
            } else { alert('请先勾选需要投喂的链接'); }
        };
    }
})();