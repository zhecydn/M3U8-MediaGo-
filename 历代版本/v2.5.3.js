// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器 (v2.5.3 又是失败版)
// @version      2.5.3
// @description  地基锁定2.4.6 | 彻底修复B站面板消失Bug | 解决index.m3u8知情权问题 | 全画质勋章 | 三态按钮
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

    // --- 1. 核心持久化 (锁定 v2.4.6) ---
    let MEDIAGO_URL = GM_getValue('mediago_url', '');
    let theme = GM_getValue('theme', 'dark');
    let target = GM_getValue('target', 'nas');
    let isMinimized = GM_getValue('is_minimized', false);
    let savedPos = GM_getValue('panel_pos', { top: '20px', left: 'auto', right: '20px' });
    let counter = GM_getValue('counter', {});

    let detectedUrls = new Set();
    let memoryVault = [];
    let panel = null;
    let gearIcon = null;

    const isBiliPage = location.hostname.includes('bilibili.com');

    // --- 2. 勋章逻辑 ---
    function getResTag(u) {
        u = u.toLowerCase();
        if (u.includes('8k') || u.includes('4320')) return '<span style="color:#ffa502;font-weight:bold;">[👑 8K]</span> ';
        if (u.includes('4k') || u.includes('2160')) return '<span style="color:#ff4757;font-weight:bold;">[💎 4K]</span> ';
        if (u.includes('1080')) return '<span style="color:#e67e22;font-weight:bold;">[🔥 1080P]</span> ';
        if (u.includes('720')) return '<span style="color:#2ed573;font-weight:bold;">[🎬 720P]</span> ';
        if (u.includes('480')) return '<span style="color:#2980b9;font-weight:bold;">[📺 480P]</span> ';
        return '';
    }

    // --- 3. 嗅探逻辑 (解决 index.m3u8 盲盒) ---
    function addUrl(url, customTitle = null, isBiliBatch = false) {
        if (typeof url !== 'string') return;
        const pureUrl = url.split('?')[0];
        if (detectedUrls.has(pureUrl)) return;
        if (!isBiliBatch && !/\.m3u8(\?|$)/i.test(url)) return;

        if (window.self !== window.top) {
            window.top.postMessage({ type: 'VIDEO_MSG_V253', url, customTitle, isBiliBatch }, '*');
            return;
        }

        detectedUrls.add(pureUrl);
        memoryVault.push({ url, customTitle, isBiliBatch });

        if (!panel && !isMinimized) createPanel();
        if (panel) renderSingleItem({ url, customTitle, isBiliBatch });
    }

    function renderSingleItem(item) {
        const list = document.getElementById('m3u8-list');
        if (!list) return;
        const li = document.createElement('li');
        li.className = 'm3u8-item';

        let tag = item.isBiliBatch ? '<span style="color:#fb7299;font-weight:bold;">[🎬 选集]</span> ' : getResTag(item.url);

        // 修正：如果是 index.m3u8，显示域名和前一段路径，保证知情权
        let displayName = item.customTitle;
        if (!displayName) {
            try {
                const uObj = new URL(item.url);
                const pathParts = uObj.pathname.split('/');
                const lastFile = pathParts.pop();
                const parentDir = pathParts.pop() || '';
                displayName = `${tag}<span style="opacity:0.5;font-size:10px;">${uObj.hostname}</span> | ${parentDir}/${lastFile}`;
            } catch(e) { displayName = `${tag}${item.url.slice(-40)}`; }
        } else { displayName = `${tag}${displayName}`; }

        li.innerHTML = `
            <input type="checkbox" class="checkbox" data-url="${item.url}" data-title="${item.customTitle || ''}">
            <div class="url-content">
                <div class="url-text" title="${item.url}">${displayName}</div>
                <button class="single-send">${target==='nas'?'投喂docker':'投喂本地'}</button>
            </div>
        `;

        li.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON') {
                const cb = li.querySelector('.checkbox');
                cb.checked = !cb.checked;
                li.classList.toggle('selected', cb.checked);
                isBiliPage ? updateBiliBtnText() : updateBatchBtnText();
            }
        };
        list.prepend(li);
        li.querySelector('.single-send').onclick = (e) => { e.stopPropagation(); sendTask(item.url, e.target, item.customTitle, item.isBiliBatch); };
    }

    // --- 4. 投喂逻辑 (稳健命名 + 三态) ---
    function sendTask(url, btn, customName = null, forceBili = false) {
        const isBili = forceBili || url.includes('bilibili.com');
        let base = (customName || document.title).replace(/[\\/:\*\?"<>\|]/g, "_").trim();
        if(!counter[base]) counter[base] = 0; counter[base]++; GM_setValue('counter', counter);
        const finalName = `${base.substring(0,30)}_${counter[base]}_${new Date().getTime().toString().slice(-4)}`;

        if (btn) { btn.innerText = "⏳ 投喂中..."; btn.style.background = "#f1c40f"; btn.style.pointerEvents = "none"; }

        const success = () => {
            if (btn) {
                btn.innerText = "✅ 已投喂成功"; btn.style.background = "#27ae60";
                setTimeout(() => {
                    btn.style.pointerEvents = "auto"; btn.style.background = "";
                    if(btn.id === 'bili-main-btn') updateBiliBtnText(); else if(btn.id === 'batch-btn') updateBatchBtnText();
                    else btn.innerText = target==='nas'?'投喂docker':'投喂本地';
                }, 2000);
            }
        };

        if (target === 'local') {
            window.open(`mediago://index.html/?n=true&name=${encodeURIComponent(finalName)}&url=${encodeURIComponent(url)}&type=${isBili?'bilibili':'m3u8'}&silent=true`, '_blank');
            success();
        } else {
            if (!MEDIAGO_URL) return alert('请设置地址');
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${MEDIAGO_URL}/api/download-now`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ name: finalName, url: url, type: isBili?'bilibili':'m3u8' }),
                onload: success
            });
        }
    }

    // --- 5. UI 构建 (强制显示补丁) ---
    function createPanel() {
        if (document.getElementById('mediago-panel')) return;
        if (gearIcon) { gearIcon.remove(); gearIcon = null; }
        panel = document.createElement('div');
        panel.id = 'mediago-panel';
        panel.className = theme;
        applyPos(panel);
        panel.innerHTML = `
            <div id="p-header"><span id="min-btn">➖</span> 🔍 m3u8嗅探器 <span id="theme-toggle" style="float:right;">🌓</span><span id="set-btn" style="float:right;margin-right:10px;">⚙️</span></div>
            <div class="top-bar">
                <button id="sel-all">全选</button>
                ${isBiliPage ? '<button id="scan-bili" style="background:#e67e22!important;">🔍 扫描选集</button><button id="bili-main-btn" style="background:#fb7299!important;">🚀 投喂直链</button>' : '<button id="batch-btn" style="background:#fd7e14!important;">🚀 一键投喂</button>'}
            </div>
            <ul id="m3u8-list"></ul>
            <div id="p-footer">
                <div class="ctrl-row">目标: <label><input type="radio" name="target" value="nas" ${target==='nas'?'checked':''}> docker</label> <label><input type="radio" name="target" value="local" ${target==='local'?'checked':''}> 本地</label></div>
                <div class="tutorial-box"><a href="https://blog.zhecydn.asia/archives/1962" target="_blank" class="mg-blog-link" style="font-size:12px!important;">📖 脚本使用教程</a></div>
            </div>`;
        document.body.appendChild(panel);
        memoryVault.forEach(item => renderSingleItem(item));
        setupEvents(panel);
    }

    function createGear() {
        if (document.getElementById('mediago-gear')) return;
        if (panel) { panel.remove(); panel = null; }
        gearIcon = document.createElement('div');
        gearIcon.id = 'mediago-gear';
        gearIcon.innerHTML = '⚙️';
        applyPos(gearIcon);
        document.body.appendChild(gearIcon);
        setupEvents(gearIcon);
    }

    function applyPos(el) { el.style.top = savedPos.top; el.style.left = savedPos.left; el.style.right = savedPos.right; }
    function updateBiliBtnText() { const btn=document.getElementById('bili-main-btn'); if(btn){ const n=panel.querySelectorAll('.checkbox:checked').length; btn.innerText=n>0?`🚀 投喂 ${n} 个`:`🚀 投喂直链`; } }
    function updateBatchBtnText() { const btn=document.getElementById('batch-btn'); if(btn){ const n=panel.querySelectorAll('.checkbox:checked').length; btn.innerText=n>0?`🚀 投喂 ${n} 个`:`🚀 一键投喂`; } }

    function setupEvents(el) {
        if (el.id === 'mediago-panel') {
            document.getElementById('min-btn').onclick = () => { isMinimized=true; GM_setValue('is_minimized',true); createGear(); };
            document.getElementById('theme-toggle').onclick = () => { theme=(theme==='dark'?'light':'dark'); GM_setValue('theme', theme); panel.className=theme; };
            document.getElementById('set-btn').onclick = () => { let u=prompt('NAS地址:', MEDIAGO_URL); if(u){ MEDIAGO_URL=u.trim().replace(/\/+$/, ''); GM_setValue('mediago_url', MEDIAGO_URL); } };
            if(isBiliPage) { document.getElementById('scan-bili').onclick = () => { document.querySelectorAll('.imageListItem_wrap__o28QW, .video-pod__item').forEach(el => { const bv = el.getAttribute('data-key'); if (bv) addUrl(`https://www.bilibili.com/video/${bv}`, el.querySelector('.title')?.innerText.trim(), true); }); updateBiliBtnText(); }; }
            document.getElementById('sel-all').onclick = () => { const cbs=panel.querySelectorAll('.checkbox'), all=Array.from(cbs).every(c=>c.checked); cbs.forEach(c=>{ c.checked=!all; c.closest('.m3u8-item').classList.toggle('selected', !all); }); isBiliPage?updateBiliBtnText():updateBatchBtnText(); };
        } else { el.onclick = () => { isMinimized=false; GM_setValue('is_minimized',false); createPanel(); }; }
        let isDrag = false, ox, oy;
        const dragHeader = el.id==='mediago-panel'?document.getElementById('p-header'):el;
        dragHeader.onmousedown = e => { if(e.target.tagName==='SPAN') return; isDrag=true; ox=e.clientX-el.offsetLeft; oy=e.clientY-el.offsetTop; };
        document.onmousemove = e => { if(isDrag){ let nx=(e.clientX-ox)+'px', ny=(e.clientY-oy)+'px'; el.style.left=nx; el.style.top=ny; el.style.right='auto'; savedPos={top:ny, left:nx, right:'auto'}; }};
        document.onmouseup = () => { if(isDrag){ isDrag=false; GM_setValue('panel_pos', savedPos); }};
    }

    GM_addStyle(`
        #mediago-panel { position: fixed !important; width: 380px !important; z-index: 2147483647 !important; border-radius: 12px !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important; display: flex !important; flex-direction: column !important; padding: 12px !important; font-family: sans-serif !important; border: 1px solid rgba(128,128,128,0.3) !important; }
        #mediago-panel.dark { background: rgba(30,30,30,0.98) !important; color: #fff !important; }
        #mediago-panel.light { background: #fff !important; color: #111 !important; }
        #p-header { cursor: move !important; padding: 8px !important; background: rgba(128,128,128,0.2) !important; border-radius: 8px !important; font-weight: bold !important; margin-bottom: 8px !important; }
        .top-bar { display: flex !important; gap: 4px !important; margin-bottom: 8px !important; }
        .top-bar button { flex: 1 !important; padding: 6px 2px !important; border: none !important; border-radius: 6px !important; cursor: pointer !important; font-size: 11px !important; font-weight: bold !important; color: #fff !important; background: #555 !important; }
        #m3u8-list { list-style: none !important; padding: 0 !important; margin: 0 !important; overflow-y: auto !important; flex: 1 !important; max-height: 380px !important; }
        .m3u8-item { display: flex !important; align-items: center !important; padding: 8px !important; background: rgba(128,128,128,0.1) !important; margin-bottom: 4px !important; border-radius: 8px !important; cursor: pointer !important; border-left: 4px solid #a55eea !important; }
        .m3u8-item.selected { background: rgba(165, 94, 234, 0.15) !important; border-left-color: #00aeec !important; }
        .url-text { font-size: 12px !important; word-break: break-all !important; line-height: 1.3 !important; }
        .single-send { width: 100% !important; background: #27ae60 !important; border: none !important; color: #fff !important; padding: 4px !important; border-radius: 5px !important; cursor: pointer !important; font-size: 11px !important; font-weight: bold !important; margin-top: 4px !important; }
        #p-footer { border-top: 1px solid rgba(128,128,128,0.2) !important; padding-top: 8px !important; }
        .ctrl-row { display: flex !important; justify-content: center !important; align-items: center !important; gap: 6px !important; margin-bottom: 4px !important; font-size: 11px !important; }
    `);

    // --- 6. 监听补丁 ---
    const oX = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u) { try { addUrl(new URL(u, location.href).href); } catch(e){} return oX.apply(this, arguments); };
    const oF = window.fetch; window.fetch = function(r) { let u = typeof r === 'string' ? r : (r && r.url); if(u){ try { addUrl(new URL(u, location.href).href); } catch(e){} } return oF.apply(this, arguments); };
    if (isMinimized) createGear(); else createPanel();
    window.addEventListener('message', e => { if (e.data && e.data.type === 'VIDEO_MSG_V253') addUrl(e.data.url, e.data.customTitle, e.data.isBiliBatch); });

    // B站刷新保底监听：如果面板被删掉，立马重建
    setInterval(() => { if (!isMinimized && !document.getElementById('mediago-panel') && detectedUrls.size > 0) createPanel(); }, 2000);
})();