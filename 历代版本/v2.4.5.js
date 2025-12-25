// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器 (v2.4.5 核心逻辑回归版)改动，但是基于这个版本
// @version      2.4.5
// @description  100%还原2.3.2核心逻辑 | 找回API/URL切换 | 修复投喂失效 | 解决齿轮重叠与数据丢失
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

    // --- 1. 变量 (完全还原 v2.3.2，一个都不少) ---
    let MEDIAGO_URL = GM_getValue('mediago_url', '');
    let theme = GM_getValue('theme', 'dark');
    let mode = GM_getValue('mode', 'api'); // 找回 API 模式
    let target = GM_getValue('target', 'nas'); // 找回 目标 模式
    let folderType = GM_getValue('folder_type', 'domain'); // 找回 归类 模式
    let counter = GM_getValue('counter', {});
    let isMinimized = GM_getValue('is_minimized', false);
    let savedPos = GM_getValue('panel_pos', { top: '20px', left: 'auto', right: '20px' });

    let detectedUrls = new Set();
    let historyData = []; // 用于在面板重建时恢复列表
    let panel = null;
    let gearIcon = null;

    const isBiliPage = location.hostname.includes('bilibili.com');

    // --- 2. 核心渲染逻辑 (还原 v2.3.2 投喂按钮逻辑) ---
    function addUrl(url, customTitle = null, isBiliBatch = false, isWatching = false) {
        if (typeof url !== 'string' || detectedUrls.has(url)) return;
        if (!isBiliBatch && !/\.m3u8(\?|$)/i.test(url)) return;
        if (url.startsWith('blob:')) return;

        if (window.self !== window.top) {
            window.top.postMessage({ type: 'VIDEO_MSG_V245', url, customTitle, isBiliBatch, isWatching }, '*');
            return;
        }

        detectedUrls.add(url);
        historyData.push({ url, customTitle, isBiliBatch, isWatching });

        if (!panel && !isMinimized) createPanel();
        if (panel) renderItem(url, customTitle, isBiliBatch, isWatching);
    }

    function renderItem(url, customTitle, isBiliBatch, isWatching) {
        const list = document.getElementById('m3u8-list');
        if (!list) return;

        const li = document.createElement('li');
        li.className = 'm3u8-item';
        let tag = isBiliBatch ? '<span style="color:#fb7299;font-weight:bold;">[🎬 选集]</span> ' : getResTag(url);
        if (isWatching) tag = '<span style="color:#27ae60;font-weight:bold;">[📺 正在观看]</span> ' + tag;

        const name = customTitle ? `${tag}${customTitle}` : `${tag}${url.split('?')[0].substring(0, 50)}...`;

        li.innerHTML = `
            <input type="checkbox" class="checkbox" data-url="${url}" data-bili="${isBiliBatch}" data-title="${customTitle || ''}">
            <div class="url-content">
                <div class="url-text" title="${url}">${name}</div>
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
        li.querySelector('.single-send').onclick = (e) => {
            e.stopPropagation();
            sendTask(url, e.target, customTitle, isBiliBatch); // 核心投喂调用
        };
    }

    // --- 3. UI 物理隔离切换 (修复齿轮 Bug) ---
    function createPanel() {
        if (document.getElementById('mediago-panel')) return;
        if (gearIcon) { gearIcon.remove(); gearIcon = null; }

        panel = document.createElement('div');
        panel.id = 'mediago-panel';
        panel.className = theme;
        applyPos(panel);
        panel.innerHTML = `
            <div id="p-header"><span id="min-btn" style="cursor:pointer;margin-right:8px;">➖</span>🔍 m3u8资源嗅探器 <span id="theme-toggle" style="float:right;cursor:pointer;margin-left:12px;">🌓</span><span id="set-btn" style="float:right;cursor:pointer;">⚙️</span></div>
            <div class="top-bar">
                <button id="sel-all">全选</button>
                ${isBiliPage ? '<button id="scan-bili" style="background:#e67e22 !important;">🔍 扫描可见选集</button><button id="bili-main-btn" style="background:#fb7299 !important;">🚀 投喂b站直链</button>' : '<button id="batch-btn" style="background:#e67e22 !important;">批量投喂</button>'}
            </div>
            <ul id="m3u8-list"></ul>
            <div id="p-footer">
                <div class="ctrl-row">目标: <label><input type="radio" name="target" value="nas" ${target==='nas'?'checked':''}> docker</label> <label><input type="radio" name="target" value="local" ${target==='local'?'checked':''}> 本地</label></div>
                <div class="ctrl-row">模式: <label><input type="radio" name="mode" value="api" ${mode==='api'?'checked':''}> API</label> <label><input type="radio" name="mode" value="url" ${mode==='url'?'checked':''}> URL</label></div>
                <div class="ctrl-row sub-row">归类: <label><input type="radio" name="folder" value="domain" ${folderType==='domain'?'checked':''}> 域名文件夹</label> <label><input type="radio" name="folder" value="default" ${folderType==='default'?'checked':''}> 默认根目录</label></div>
                <div style="text-align:center; margin-top:8px; border-top:1px dashed rgba(128,128,128,0.3); padding-top:8px;">
                    <a href="https://blog.zhecydn.asia/archives/1962" target="_blank" style="color:#a55eea; text-decoration:none; font-size:10px; opacity:0.8; font-weight:bold;">📖 脚本使用教程</a>
                </div>
            </div>`;
        (document.body || document.documentElement).appendChild(panel);

        // 恢复数据
        historyData.forEach(item => renderItem(item.url, item.customTitle, item.isBiliBatch, item.isWatching));
        setupEvents(panel);
    }

    function createGear() {
        if (document.getElementById('mediago-gear')) return;
        if (panel) { panel.remove(); panel = null; }

        gearIcon = document.createElement('div');
        gearIcon.id = 'mediago-gear';
        gearIcon.innerHTML = '⚙️';
        applyPos(gearIcon);
        (document.body || document.documentElement).appendChild(gearIcon);
        setupEvents(gearIcon);
    }

    function toggleMin(toMin) {
        isMinimized = toMin;
        GM_setValue('is_minimized', isMinimized);
        if (isMinimized) createGear(); else createPanel();
    }

    // --- 4. 投喂逻辑 (100% 还原 v2.3.2，修复失效) ---
    function sendTask(url, btn, customName = null, forceBili = false) {
        const isBili = forceBili || url.includes('bilibili.com');
        const finalType = isBili ? 'bilibili' : 'm3u8';
        const finalName = getSmartName(customName || document.title);
        const folder = folderType === 'domain' ? location.hostname.split('.')[0] : '';
        const encodedName = encodeURIComponent(finalName), encodedUrl = encodeURIComponent(url);
        const folderParam = folder ? `&folder=${encodeURIComponent(folder)}` : '';

        if (target === 'local') {
            window.open(`mediago://index.html/?n=true&name=${encodedName}&url=${encodedUrl}&type=${finalType}&silent=true${folderParam}`, '_blank');
        } else {
            if (!MEDIAGO_URL) return alert('请先⚙️设置 mediago docker 地址');
            if (mode === 'api') {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${MEDIAGO_URL}/api/download-now`,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ name: finalName, url: url, type: finalType, folder: folder }),
                    onload: () => { if(btn) { btn.innerText = "✅ 投喂成功"; btn.style.opacity = "0.5"; } },
                    onerror: () => { alert("投喂失败，请检查Docker地址或网络"); }
                });
            } else {
                window.open(`${MEDIAGO_URL}/?n=true&name=${encodedName}&url=${encodedUrl}&type=${finalType}&silent=true${folderParam}`, '_blank');
            }
        }
        if (btn && mode !== 'api') { btn.innerText = "✅ 已投喂"; btn.style.opacity = "0.5"; }
    }

    // --- 5. 其他辅助函数 (B站扫描、ResTag等 100% 还原) ---
    function scanBili() {
        let count = 0;
        document.querySelectorAll('.imageListItem_wrap__o28QW').forEach(el => {
            const a = el.querySelector('a'), titleWrap = el.querySelector('.imageListItem_titleWrap__YTlLH');
            if (a && titleWrap) {
                const url = new URL(a.getAttribute('href'), location.href).href;
                addUrl(url, titleWrap.getAttribute('title'), true, titleWrap.classList.contains('imageListItem_active__fKB0s'));
                count++;
            }
        });
        document.querySelectorAll('.video-pod__item').forEach(el => {
            const bv = el.getAttribute('data-key'), titleEl = el.querySelector('.title');
            if (bv && titleEl) {
                const isWatching = el.querySelector('.simple-base-item')?.classList.contains('active') || !!el.querySelector('.playing-gif');
                addUrl(`https://www.bilibili.com/video/${bv}`, titleEl.innerText.trim(), true, isWatching);
                count++;
            }
        });
        if (count > 0) updateBiliBtnText();
    }

    function applyPos(el) { el.style.top = savedPos.top; el.style.left = savedPos.left; el.style.right = savedPos.right; }
    function getResTag(u) { u=u.toLowerCase(); if(u.includes('8k'))return'[👑 8K] '; if(u.includes('4k'))return'[💎 4K] '; if(u.includes('1080'))return'[🔥 1080P] '; return ''; }
    function getSmartName(base) { if (!counter[base]) counter[base] = 0; counter[base]++; GM_setValue('counter', counter); return `${base.substring(0,30)}_${counter[base]}_${new Date().getTime().toString().slice(-4)}`; }
    function updateBiliBtnText() { const btn=document.getElementById('bili-main-btn'); if(btn){ const n=panel.querySelectorAll('.checkbox:checked').length; btn.innerText=n>0?`🚀 投喂 ${n} 个b站直链`:`🚀 投喂b站直链`; } }
    function updateBatchBtnText() { const btn=document.getElementById('batch-btn'); if(btn){ const n=panel.querySelectorAll('.checkbox:checked').length; btn.innerText=n>0?`🚀 投喂 ${n} 个直链`:`批量投喂`; } }

    function setupEvents(el) {
        if (el.id === 'mediago-panel') {
            document.getElementById('min-btn').onclick = () => toggleMin(true);
            document.getElementById('theme-toggle').onclick = () => { theme=(theme==='dark'?'light':'dark'); GM_setValue('theme', theme); panel.className=theme; };
            document.getElementById('set-btn').onclick = () => { let u=prompt('NAS地址:', MEDIAGO_URL); if(u){ MEDIAGO_URL=u.trim().replace(/\/+$/, ''); GM_setValue('mediago_url', MEDIAGO_URL); } };
            if(isBiliPage) {
                document.getElementById('scan-bili').onclick = scanBili;
                document.getElementById('bili-main-btn').onclick = () => {
                    const checked = panel.querySelectorAll('.checkbox:checked');
                    if(checked.length) checked.forEach((cb, i) => setTimeout(() => sendTask(cb.dataset.url, null, cb.dataset.title, true), i*1000));
                    else sendTask(location.href.split('?')[0], null, document.title.split('_')[0]);
                };
            } else {
                document.getElementById('batch-btn').onclick = () => {
                    const checked = panel.querySelectorAll('.checkbox:checked');
                    if(checked.length) {
                        const p = prompt(`批量投喂:`, document.title);
                        if(p) checked.forEach((cb, i) => setTimeout(() => sendTask(cb.dataset.url, null, `${p}_${i+1}`), i*800));
                    }
                };
            }
            document.getElementById('sel-all').onclick = () => { const cbs=panel.querySelectorAll('.checkbox'), all=Array.from(cbs).every(c=>c.checked); cbs.forEach(c=>{ c.checked=!all; c.closest('.m3u8-item').classList.toggle('selected', !all); }); isBiliPage?updateBiliBtnText():updateBatchBtnText(); };
            panel.querySelectorAll('input[name="target"]').forEach(r => r.onchange = e => { target=e.target.value; GM_setValue('target', target); });
            panel.querySelectorAll('input[name="mode"]').forEach(r => r.onchange = e => { mode=e.target.value; GM_setValue('mode', mode); });
            panel.querySelectorAll('input[name="folder"]').forEach(r => r.onchange = e => { folderType=e.target.value; GM_setValue('folder_type', folderType); });
        } else {
            el.onclick = () => { if(el.dataset.dragged!=='true') toggleMin(false); };
        }

        let isDrag = false, ox, oy;
        const targetEl = el;
        const dragHeader = el.id==='mediago-panel'?document.getElementById('p-header'):el;
        dragHeader.onmousedown = e => { if(e.target.tagName==='SPAN') return; isDrag=true; targetEl.dataset.dragged='false'; ox=e.clientX-targetEl.offsetLeft; oy=e.clientY-targetEl.offsetTop; };
        document.onmousemove = e => { if(isDrag){ targetEl.dataset.dragged='true'; let nx=(e.clientX-ox)+'px', ny=(e.clientY-oy)+'px'; targetEl.style.left=nx; targetEl.style.top=ny; targetEl.style.right='auto'; savedPos={top:ny, left:nx, right:'auto'}; }};
        document.onmouseup = () => { if(isDrag){ isDrag=false; GM_setValue('panel_pos', savedPos); }};
    }

    // --- 6. 样式 (完全还原 v2.3.2) ---
    GM_addStyle(`
        #mediago-panel { position: fixed !important; width: 380px !important; max-height: 85vh !important; z-index: 2147483647 !important; border-radius: 12px !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important; display: flex !important; flex-direction: column !important; padding: 12px !important; font-family: sans-serif !important; border: 1px solid rgba(128,128,128,0.3) !important; }
        #mediago-panel.dark { background: rgba(30,30,30,0.95) !important; color: #fff !important; }
        #mediago-panel.light { background: rgba(255,255,255,0.98) !important; color: #111 !important; }
        #mediago-gear { position: fixed !important; width: 42px !important; height: 42px !important; background: rgba(30,30,30,0.9) !important; color: #fb7299 !important; border-radius: 50% !important; z-index: 2147483647 !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; font-size: 24px !important; box-shadow: 0 4px 15px rgba(0,0,0,0.4) !important; border: 1px solid rgba(251,114,153,0.4) !important; }
        #p-header { cursor: move !important; padding: 10px !important; background: rgba(128,128,128,0.2) !important; border-radius: 8px !important; font-weight: bold !important; font-size: 13px !important; margin-bottom: 8px !important; }
        .top-bar { display: flex !important; gap: 6px !important; margin-bottom: 10px !important; }
        .top-bar button { flex: 1 !important; padding: 8px 4px !important; border: none !important; border-radius: 6px !important; cursor: pointer !important; font-size: 11px !important; font-weight: bold !important; color: #fff !important; background: #666 !important; }
        #m3u8-list { list-style: none !important; padding: 0 !important; margin: 0 !important; overflow-y: auto !important; flex: 1 !important; }
        .m3u8-item { display: flex !important; align-items: center !important; padding: 10px !important; background: rgba(128,128,128,0.1) !important; margin-bottom: 6px !important; border-radius: 8px !important; cursor: pointer !important; border-left: 4px solid #a55eea !important; }
        .m3u8-item.selected { background: rgba(165, 94, 234, 0.15) !important; border-left-color: #00aeec !important; }
        .checkbox { margin-right: 12px !important; width: 16px !important; height: 16px !important; cursor: pointer !important; }
        .url-text { font-size: 12px !important; word-break: break-all !important; line-height: 1.4 !important; }
        .single-send { width: 100% !important; background: #27ae60 !important; border: none !important; color: #fff !important; padding: 5px !important; border-radius: 5px !important; cursor: pointer !important; font-size: 11px !important; font-weight: bold !important; margin-top: 5px !important; }
        #p-footer { font-size: 11px !important; border-top: 1px solid rgba(128,128,128,0.2) !important; padding-top: 10px !important; }
        .ctrl-row { display: flex !important; justify-content: center !important; gap: 8px !important; margin-bottom: 5px !important; }
    `);

    // --- 7. 注入侦听 ---
    const oX = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u) { try { addUrl(new URL(u, location.href).href); } catch(e){} return oX.apply(this, arguments); };
    const oF = window.fetch; window.fetch = function(r) { let u = typeof r === 'string' ? r : (r && r.url); if(u){ try { addUrl(new URL(u, location.href).href); } catch(e){} } return oF.apply(this, arguments); };

    // 初始化启动 (增加 B站 唤醒保护)
    const init = () => { if (isMinimized) createGear(); else createPanel(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    if (isBiliPage) setInterval(() => { if(!panel && !gearIcon) init(); }, 3000);

    window.addEventListener('message', e => { if (e.data && e.data.type === 'VIDEO_MSG_V245') addUrl(e.data.url, e.data.customTitle, e.data.isBiliBatch, e.data.isWatching); });
})();