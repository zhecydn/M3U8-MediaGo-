// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器 (v2.5.1 失败测试版本)
// @version      2.5.1
// @description  地基锁定2.4.6 | 回归2.1算法与2.3.2质感 | 全画质勋章(含480P) | 三态反馈 | 物理隔离
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

    // --- [1. 核心持久化地基 - 严格遵循 v2.4.6] ---
    let MEDIAGO_URL = GM_getValue('mediago_url', '');
    let theme = GM_getValue('theme', 'dark');
    let mode = GM_getValue('mode', 'api');
    let target = GM_getValue('target', 'nas');
    let folderType = GM_getValue('folder_type', 'domain');
    let counter = GM_getValue('counter', {});
    let isMinimized = GM_getValue('is_minimized', false);
    let savedPos = GM_getValue('panel_pos', { top: '20px', left: 'auto', right: '20px' });

    let detectedUrls = new Set();
    let memoryVault = []; // 内存金库，确保物理切换不丢数
    let panel = null;
    let gearIcon = null;

    const isBiliPage = location.hostname.includes('bilibili.com');

    // --- [2. 灵魂回归：全画质勋章逻辑] ---
    function getResTag(u) {
        u = u.toLowerCase();
        if (u.includes('8k') || u.includes('4320')) return '<span style="color:#ffa502;font-weight:bold;">[👑 8K]</span> ';
        if (u.includes('4k') || u.includes('2160')) return '<span style="color:#ff4757;font-weight:bold;">[💎 4K]</span> ';
        if (u.includes('1080')) return '<span style="color:#e67e22;font-weight:bold;">[🔥 1080P]</span> ';
        if (u.includes('720')) return '<span style="color:#2ed573;font-weight:bold;">[🎬 720P]</span> ';
        if (u.includes('480')) return '<span style="color:#2980b9;font-weight:bold;">[📺 480P]</span> ';
        return '';
    }

    // --- [3. 嗅探引擎：智能过滤与指纹去重 (回归 2.1)] ---
    function addUrl(url, customTitle = null, isBiliBatch = false) {
        if (typeof url !== 'string') return;
        // 路径指纹去重，忽略随机参数
        const pureUrl = url.split('?')[0];
        if (detectedUrls.has(pureUrl)) return;

        if (!isBiliBatch && !/\.m3u8(\?|$)/i.test(url)) return;
        if (url.startsWith('blob:')) return;

        // 跨域补完
        if (window.self !== window.top) {
            window.top.postMessage({ type: 'VIDEO_MSG_V251', url, customTitle, isBiliBatch }, '*');
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

        // 知情权显示逻辑：[勋章] 域名 | 文件名
        let displayName = "";
        if (item.customTitle) {
            displayName = `${tag}${item.customTitle}`;
        } else {
            try {
                const uObj = new URL(item.url);
                displayName = `${tag}<span style="opacity:0.5;font-size:10px;">${uObj.hostname}</span> | ${uObj.pathname.split('/').pop()}`;
            } catch(e) { displayName = `${tag}未知资源`; }
        }

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
        li.querySelector('.single-send').onclick = (e) => {
            e.stopPropagation();
            sendTask(item.url, e.target, item.customTitle, item.isBiliBatch);
        };
    }

    // --- [4. 投喂逻辑：智能命名与三态反馈] ---
    function sendTask(url, btn, customName = null, forceBili = false) {
        const isBili = forceBili || url.includes('bilibili.com');
        const finalType = isBili ? 'bilibili' : 'm3u8';

        // 2.1 命名算法：标题 + 计数 + 时间戳
        let baseName = (customName || document.title).replace(/[\\/:\*\?"<>\|]/g, "_").trim();
        if(!counter[baseName]) counter[baseName] = 0;
        counter[baseName]++;
        GM_setValue('counter', counter);
        const finalName = `${baseName.substring(0,30)}_${counter[baseName]}_${new Date().getTime().toString().slice(-4)}`;

        if (btn) {
            btn.innerText = "⏳ 投喂中...";
            btn.style.background = "#f1c40f";
            btn.style.pointerEvents = "none"; // 连点保护
        }

        const successAction = () => {
            if (btn) {
                btn.innerText = "✅ 已投喂成功";
                btn.style.background = "#27ae60";
                setTimeout(() => {
                    btn.style.pointerEvents = "auto";
                    btn.style.background = "";
                    if(btn.id === 'bili-main-btn') updateBiliBtnText();
                    else if(btn.id === 'batch-btn') updateBatchBtnText();
                    else btn.innerText = target==='nas'?'投喂docker':'投喂本地';
                }, 2000);
            }
        };

        if (target === 'local') {
            const folder = folderType === 'domain' ? location.hostname.split('.')[0] : '';
            window.open(`mediago://index.html/?n=true&name=${encodeURIComponent(finalName)}&url=${encodeURIComponent(url)}&type=${finalType}&silent=true&folder=${folder}`, '_blank');
            successAction();
        } else {
            if (!MEDIAGO_URL) return alert('请先⚙️设置地址');
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${MEDIAGO_URL}/api/download-now`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ name: finalName, url: url, type: finalType, folder: folderType==='domain'?location.hostname.split('.')[0]:'' }),
                onload: () => successAction(),
                onerror: () => { if(btn) { btn.innerText = "❌ 失败"; btn.style.background = "#e74c3c"; btn.style.pointerEvents="auto"; } }
            });
        }
    }

    // --- [5. UI & 物理隔离逻辑 - 完全沿用 2.4.6 地基] ---
    function createPanel() {
        if (document.getElementById('mediago-panel')) return;
        if (gearIcon) { gearIcon.remove(); gearIcon = null; }

        panel = document.createElement('div');
        panel.id = 'mediago-panel';
        panel.className = theme;
        applyPos(panel);
        panel.innerHTML = `
            <div id="p-header">
                <div class="header-main"><span id="min-btn">➖</span> 🔍 m3u8资源嗅探器</div>
                <div class="header-tools"><span id="theme-toggle">🌓</span><span id="set-btn">⚙️</span></div>
            </div>
            <div class="top-bar">
                <button id="sel-all">全选</button>
                ${isBiliPage ? '<button id="scan-bili" style="background:#e67e22 !important;">🔍 扫描选集</button><button id="bili-main-btn" style="background:#fb7299 !important;">🚀 投喂直链</button>' : '<button id="batch-btn" style="background:#fd7e14 !important;">🚀 一键投喂</button>'}
            </div>
            <ul id="m3u8-list"></ul>
            <div id="p-footer">
                <div class="ctrl-row">目标: <label><input type="radio" name="target" value="nas" ${target==='nas'?'checked':''}> docker</label> <label><input type="radio" name="target" value="local" ${target==='local'?'checked':''}> 本地</label> | 模式: <label><input type="radio" name="mode" value="api" ${mode==='api'?'checked':''}> API</label> <label><input type="radio" name="mode" value="url" ${mode==='url'?'checked':''}> URL</label></div>
                <div class="ctrl-row">归类: <label><input type="radio" name="folder" value="domain" ${folderType==='domain'?'checked':''}> 域名文件夹</label> <label><input type="radio" name="folder" value="default" ${folderType==='default'?'checked':''}> 默认根目录</label></div>
                <div class="tutorial-box"><a href="https://blog.zhecydn.asia/archives/1962" target="_blank" class="mg-blog-link">📖 脚本使用教程</a></div>
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

    function toggleMin(toMin) {
        isMinimized = toMin;
        GM_setValue('is_minimized', isMinimized);
        if (isMinimized) createGear(); else createPanel();
    }

    function scanBili() {
        let count = 0;
        document.querySelectorAll('.imageListItem_wrap__o28QW, .video-pod__item').forEach(el => {
            const bv = el.getAttribute('data-key');
            if (bv) { addUrl(`https://www.bilibili.com/video/${bv}`, el.querySelector('.title')?.innerText.trim(), true); count++; }
        });
        if (count === 0) alert("雷达空空...这好像是个单集视频哦，请先展开选集列表再扫描，或者直接投喂当前视频！🧐");
        else updateBiliBtnText();
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
                document.getElementById('scan-bili').onclick = scanBili;
                document.getElementById('bili-main-btn').onclick = function() {
                    const checked = panel.querySelectorAll('.checkbox:checked');
                    if(checked.length) checked.forEach((cb, i) => setTimeout(() => sendTask(cb.dataset.url, this, cb.dataset.title, true), i*1000));
                    else sendTask(location.href.split('?')[0], this, document.title.split('_')[0]);
                };
            } else {
                document.getElementById('batch-btn').onclick = function() {
                    const checked = panel.querySelectorAll('.checkbox:checked');
                    if(checked.length) {
                        const p = prompt(`🚀 一键投喂:`, document.title);
                        if(p) checked.forEach((cb, i) => setTimeout(() => sendTask(cb.dataset.url, this, `${p}_${i+1}`), i*800));
                    }
                };
            }
            document.getElementById('sel-all').onclick = () => { const cbs=panel.querySelectorAll('.checkbox'), all=Array.from(cbs).every(c=>c.checked); cbs.forEach(c=>{ c.checked=!all; c.closest('.m3u8-item').classList.toggle('selected', !all); }); isBiliPage?updateBiliBtnText():updateBatchBtnText(); };
            panel.querySelectorAll('input[name="target"]').forEach(r => r.onchange = e => { target=e.target.value; GM_setValue('target', target); });
            panel.querySelectorAll('input[name="mode"]').forEach(r => r.onchange = e => { mode=e.target.value; GM_setValue('mode', mode); });
            panel.querySelectorAll('input[name="folder"]').forEach(r => r.onchange = e => { folderType=e.target.value; GM_setValue('folder_type', folderType); });
        } else { el.onclick = () => { if(el.dataset.dragged!=='true') toggleMin(false); }; }

        let isDrag = false, ox, oy;
        const dragHeader = el.id==='mediago-panel'?document.getElementById('p-header'):el;
        dragHeader.onmousedown = e => { if(e.target.tagName==='SPAN') return; isDrag=true; el.dataset.dragged='false'; ox=e.clientX-el.offsetLeft; oy=e.clientY-el.offsetTop; };
        document.onmousemove = e => { if(isDrag){ el.dataset.dragged='true'; let nx=(e.clientX-ox)+'px', ny=(e.clientY-oy)+'px'; el.style.left=nx; el.style.top=ny; el.style.right='auto'; savedPos={top:ny, left:nx, right:'auto'}; }};
        document.onmouseup = () => { if(isDrag){ isDrag=false; GM_setValue('panel_pos', savedPos); }};
    }

    GM_addStyle(`
        #mediago-panel { position: fixed !important; width: 380px !important; z-index: 2147483647 !important; border-radius: 12px !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important; display: flex !important; flex-direction: column !important; padding: 12px !important; font-family: sans-serif !important; border: 1px solid rgba(128,128,128,0.3) !important; font-size: 13px !important; transition: background 0.2s, opacity 0.2s !important; }
        #mediago-panel.dark { background: rgba(30,30,30,0.95) !important; color: #fff !important; }
        #mediago-panel.light { background: rgba(255,255,255,0.98) !important; color: #111 !important; }
        #p-header { cursor: move !important; display: flex; justify-content: space-between; align-items: center; padding: 8px !important; background: rgba(128,128,128,0.2) !important; border-radius: 8px !important; font-weight: bold !important; margin-bottom: 8px !important; }
        .header-tools span { cursor: pointer; margin-left: 12px; transition: opacity 0.2s; }
        .header-tools span:hover { opacity: 0.6; }
        #mediago-gear { position: fixed !important; width: 44px !important; height: 44px !important; background: rgba(30,30,30,0.9) !important; color: #fb7299 !important; border-radius: 50% !important; z-index: 2147483647 !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; font-size: 24px !important; box-shadow: 0 4px 15px rgba(0,0,0,0.4) !important; border: 1px solid rgba(251,114,153,0.4) !important; }
        .top-bar { display: flex !important; gap: 4px !important; margin-bottom: 8px !important; }
        .top-bar button { flex: 1 !important; padding: 6px 2px !important; border: none !important; border-radius: 6px !important; cursor: pointer !important; font-size: 11px !important; font-weight: bold !important; color: #fff !important; background: #555 !important; }
        #m3u8-list { list-style: none !important; padding: 0 !important; margin: 0 !important; overflow-y: auto !important; flex: 1 !important; max-height: 380px !important; }
        .m3u8-item { display: flex !important; align-items: center !important; padding: 8px !important; background: rgba(128,128,128,0.1) !important; margin-bottom: 4px !important; border-radius: 8px !important; cursor: pointer !important; border-left: 4px solid #a55eea !important; transition: 0.2s !important; }
        .m3u8-item.selected { background: rgba(165, 94, 234, 0.15) !important; border-left-color: #00aeec !important; }
        .url-text { font-size: 12px !important; word-break: break-all !important; line-height: 1.3 !important; }
        .single-send { width: 100% !important; background: #27ae60 !important; border: none !important; color: #fff !important; padding: 4px !important; border-radius: 5px !important; cursor: pointer !important; font-size: 11px !important; font-weight: bold !important; margin-top: 4px !important; transition: 0.2s !important; }
        #p-footer { border-top: 1px solid rgba(128,128,128,0.2) !important; padding-top: 8px !important; }
        .ctrl-row { display: flex !important; justify-content: center !important; align-items: center !important; gap: 6px !important; margin-bottom: 4px !important; font-size: 11px !important; }
        .tutorial-box { text-align: center !important; margin-top: 6px !important; padding-top: 4px !important; border-top: 1px dashed rgba(128,128,128,0.3) !important; }
        .mg-blog-link { color: #a55eea !important; text-decoration: none !important; font-size: 12px !important; font-weight: bold !important; }
    `);

    const oX = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u) { try { addUrl(new URL(u, location.href).href); } catch(e){} return oX.apply(this, arguments); };
    const oF = window.fetch; window.fetch = function(r) { let u = typeof r === 'string' ? r : (r && r.url); if(u){ try { addUrl(new URL(u, location.href).href); } catch(e){} } return oF.apply(this, arguments); };
    if (isMinimized) createGear(); else createPanel();
    window.addEventListener('message', e => { if (e.data && e.data.type === 'VIDEO_MSG_V251') addUrl(e.data.url, e.data.customTitle, e.data.isBiliBatch); });
})();