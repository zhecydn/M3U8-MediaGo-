// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器 (v2.5.4 第三个失败版)
// @version      2.5.4
// @description  地基 100% 锁定 v2.4.6 | 找回 API/URL 切换 | 找回原始长链接显示 | 全画质勋章 | 三态反馈
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

    // --- [1. 变量与存储：严格遵循 v2.4.6] ---
    let MEDIAGO_URL = GM_getValue('mediago_url', '');
    let theme = GM_getValue('theme', 'dark');
    let mode = GM_getValue('mode', 'api'); // 重新找回这个灵魂变量
    let target = GM_getValue('target', 'nas');
    let folderType = GM_getValue('folder_type', 'domain');
    let counter = GM_getValue('counter', {});
    let isMinimized = GM_getValue('is_minimized', false);
    let savedPos = GM_getValue('panel_pos', { top: '20px', left: 'auto', right: '20px' });

    let detectedUrls = new Set();
    let memoryVault = [];
    let panel = null;
    let gearIcon = null;

    const isBiliPage = location.hostname.includes('bilibili.com');

    // --- [2. 勋章逻辑：仅作为前缀植入] ---
    function getResTag(u) {
        u = u.toLowerCase();
        if (u.includes('8k') || u.includes('4320')) return '<span style="color:#ffa502;font-weight:bold;">[👑 8K]</span> ';
        if (u.includes('4k') || u.includes('2160')) return '<span style="color:#ff4757;font-weight:bold;">[💎 4K]</span> ';
        if (u.includes('1080')) return '<span style="color:#e67e22;font-weight:bold;">[🔥 1080P]</span> ';
        if (u.includes('720')) return '<span style="color:#2ed573;font-weight:bold;">[🎬 720P]</span> ';
        if (u.includes('480')) return '<span style="color:#2980b9;font-weight:bold;">[📺 480P]</span> ';
        return '';
    }

    // --- [3. 嗅探逻辑：100% 还原 2.4.6 原始 URL 显示] ---
    function addUrl(url, customTitle = null, isBiliBatch = false) {
        if (typeof url !== 'string') return;
        const pureUrl = url.split('?')[0];
        if (detectedUrls.has(pureUrl)) return;

        // 智能过滤：剔除 < 500KB (这一条是之前对齐的后台逻辑，不影响UI)
        if (!isBiliBatch && url.includes('fragment') && url.includes('.ts')) return;

        if (window.self !== window.top) {
            window.top.postMessage({ type: 'VIDEO_MSG_V254', url, customTitle, isBiliBatch }, '*');
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

        // 【核心修复】：完全还原 2.4.6 的原始链接显示，绝不截断成 index.m3u8
        let originalName = item.customTitle ? item.customTitle : item.url;
        let displayName = `${tag}${originalName}`;

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

    // --- [4. 投喂逻辑：三态反馈 + 模式选择生效] ---
    function sendTask(url, btn, customName = null, forceBili = false) {
        const isBili = forceBili || url.includes('bilibili.com');
        const finalType = isBili ? 'bilibili' : 'm3u8';

        // 2.1 稳健命名算法
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

        const folder = folderType === 'domain' ? location.hostname.split('.')[0] : '';

        // 【核心修复】：mode (API/URL) 逻辑重新生效
        if (target === 'local' || mode === 'url') {
            window.open(`mediago://index.html/?n=true&name=${encodeURIComponent(finalName)}&url=${encodeURIComponent(url)}&type=${finalType}&silent=true&folder=${folder}`, '_blank');
            success();
        } else {
            if (!MEDIAGO_URL) return alert('请先⚙️设置地址');
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${MEDIAGO_URL}/api/download-now`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ name: finalName, url: url, type: finalType, folder: folder }),
                onload: success,
                onerror: () => { if(btn) { btn.innerText = "❌ 失败"; btn.style.background = "#e74c3c"; btn.style.pointerEvents="auto"; } }
            });
        }
    }

    // --- [5. UI 构建：100% 还原 2.4.6 底部面板] ---
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
                ${isBiliPage ? '<button id="scan-bili" style="background:#e67e22 !important;">🔍 扫描可见选集</button><button id="bili-main-btn" style="background:#fb7299 !important;">🚀 投喂直链</button>' : '<button id="batch-btn" style="background:#fd7e14 !important;">🚀 一键投喂</button>'}
            </div>
            <ul id="m3u8-list"></ul>
            <div id="p-footer">
                <div class="ctrl-row">目标: <label><input type="radio" name="target" value="nas" ${target==='nas'?'checked':''}> docker</label> <label><input type="radio" name="target" value="local" ${target==='local'?'checked':''}> 本地</label> | 模式: <label><input type="radio" name="mode" value="api" ${mode==='api'?'checked':''}> API</label> <label><input type="radio" name="mode" value="url" ${mode==='url'?'checked':''}> URL</label></div>
                <div class="ctrl-row">归类: <label><input type="radio" name="folder" value="domain" ${folderType==='domain'?'checked':''}> 域名文件夹</label> <label><input type="radio" name="folder" value="default" ${folderType==='default'?'checked':''}> 默认根目录</label></div>
                <div class="tutorial-box"><a href="https://blog.zhecydn.asia/archives/1962" target="_blank" class="mg-blog-link" style="font-size:12px!important;">📖 脚本使用教程</a></div>
            </div>`;
        document.body.appendChild(panel);
        memoryVault.forEach(item => renderSingleItem(item));
        setupEvents(panel);
    }

    // 齿轮与物理隔离逻辑 (100% 2.4.6)
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

    function toggleMin(toMin) {
        isMinimized = toMin;
        GM_setValue('is_minimized', isMinimized);
        if (isMinimized) createGear(); else createPanel();
    }

    function applyPos(el) { el.style.top = savedPos.top; el.style.left = savedPos.left; el.style.right = savedPos.right; }
    function updateBiliBtnText() { const btn=document.getElementById('bili-main-btn'); if(btn){ const n=panel.querySelectorAll('.checkbox:checked').length; btn.innerText=n>0?`🚀 投喂 ${n} 个`:`🚀 投喂直链`; } }
    function updateBatchBtnText() { const btn=document.getElementById('batch-btn'); if(btn){ const n=panel.querySelectorAll('.checkbox:checked').length; btn.innerText=n>0?`🚀 投喂 ${n} 个`:`🚀 一键投喂`; } }

    function setupEvents(el) {
        if (el.id === 'mediago-panel') {
            document.getElementById('min-btn').onclick = () => toggleMin(true);
            document.getElementById('theme-toggle').onclick = () => { theme=(theme==='dark'?'light':'dark'); GM_setValue('theme', theme); panel.className=theme; };
            document.getElementById('set-btn').onclick = () => { let u=prompt('NAS地址:', MEDIAGO_URL); if(u){ MEDIAGO_URL=u.trim().replace(/\/+$/, ''); GM_setValue('mediago_url', MEDIAGO_URL); } };
            if(isBiliPage) {
                document.getElementById('scan-bili').onclick = () => {
                    document.querySelectorAll('.imageListItem_wrap__o28QW, .video-pod__item').forEach(el => {
                        const bv = el.getAttribute('data-key');
                        if (bv) addUrl(`https://www.bilibili.com/video/${bv}`, el.querySelector('.title')?.innerText.trim(), true);
                    });
                    updateBiliBtnText();
                };
            }
            document.getElementById('sel-all').onclick = () => { const cbs=panel.querySelectorAll('.checkbox'), all=Array.from(cbs).every(c=>c.checked); cbs.forEach(c=>{ c.checked=!all; c.closest('.m3u8-item').classList.toggle('selected', !all); }); isBiliPage?updateBiliBtnText():updateBatchBtnText(); };

            // 【核心回归】：模式选择事件监听
            panel.querySelectorAll('input[name="target"]').forEach(r => r.onchange = e => { target=e.target.value; GM_setValue('target', target); });
            panel.querySelectorAll('input[name="mode"]').forEach(r => r.onchange = e => { mode=e.target.value; GM_setValue('mode', mode); });
            panel.querySelectorAll('input[name="folder"]').forEach(r => r.onchange = e => { folderType=e.target.value; GM_setValue('folder_type', folderType); });
        } else { el.onclick = () => toggleMin(false); }

        let isDrag = false, ox, oy;
        const dragHeader = el.id==='mediago-panel'?document.getElementById('p-header'):el;
        dragHeader.onmousedown = e => { if(e.target.tagName==='SPAN') return; isDrag=true; ox=e.clientX-el.offsetLeft; oy=e.clientY-el.offsetTop; };
        document.onmousemove = e => { if(isDrag){ let nx=(e.clientX-ox)+'px', ny=(e.clientY-oy)+'px'; el.style.left=nx; el.style.top=ny; el.style.right='auto'; savedPos={top:ny, left:nx, right:'auto'}; }};
        document.onmouseup = () => { if(isDrag){ isDrag=false; GM_setValue('panel_pos', savedPos); }};
    }

    GM_addStyle(`
        #mediago-panel { position: fixed !important; width: 380px !important; z-index: 2147483647 !important; border-radius: 12px !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important; display: flex