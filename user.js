// ==UserScript==
// @name         M3U8 嗅探 + MediaGo 投喂器
// @namespace    https://blog.zhecydn.asia/
// @version      1.0
// @description  可拖动面板 + 批量投喂 + 主题切换 + 面板内配置地址 + 双模式 + 智能命名（完全无隐私泄露）
// @author       zhecydn
// @match        *://*/*
// @license MIT
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
 
(function() {
    'use strict';
 
    // 配置区
    let MEDIAGO_URL = GM_getValue('mediago_url', '');
    let theme = GM_getValue('theme', 'auto'); // 'dark', 'light', 'auto'
    let mode = GM_getValue('mode', 'api'); // 'api' 或 'url'
    let counter = GM_getValue('counter', {}); // 序号记忆
 
    let detectedM3u8 = new Set();
    let panel = null;
 
    // 应用主题
    function applyTheme() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark = (theme === 'auto' ? prefersDark : theme === 'dark');
 
        document.documentElement.style.setProperty('--bg', isDark ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.92)');
        document.documentElement.style.setProperty('--text', isDark ? 'white' : 'black');
        document.documentElement.style.setProperty('--sub-bg', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');
        document.documentElement.style.setProperty('--header-bg', isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)');
        document.documentElement.style.setProperty('--button-bg', isDark ? '#00ff88' : '#00cc66');
        document.documentElement.style.setProperty('--button-hover', isDark ? '#00cc66' : '#00994d');
    }
 
    // 创建面板
    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'mediago-panel';
        panel.innerHTML = `
            <div id="panel-header">
                🔔 检测到 m3u8 资源
                <span style="float:right;font-size:18px;cursor:pointer;" id="theme-toggle">🌙</span>
                <span style="float:right;margin-right:10px;cursor:pointer;" id="settings-btn">⚙️</span>
            </div>
            <div style="text-align:center;margin:10px 0;">
                <button id="select-all">全选</button>
                <button id="batch-send" style="margin-left:10px;background:#ff9900;">批量投喂选中</button>
            </div>
            <ul id="m3u8-list"></ul>
            <div id="controls" style="margin-top:15px;padding-top:10px;border-top:1px solid #444;text-align:center;">
                <label><input type="radio" name="mode" value="api" ${mode==='api'?'checked':''}> 纯 API（完全静默）</label>&nbsp;&nbsp;
                <label><input type="radio" name="mode" value="url" ${mode==='url'?'checked':''}> URL 参数（支持 Referer）</label>
            </div>
            <small style="display:block;text-align:center;margin-top:10px;color:#aaa;">
                拖动标题栏移动 · 批量投喂更高效
            </small>
        `;
        GM_addStyle(`
            :root { --bg: rgba(0,0,0,0.92); --text: white; --sub-bg: rgba(255,255,255,0.05); --header-bg: rgba(255,255,255,0.1); --button-bg: #00ff88; --button-hover: #00cc66; }
            #mediago-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 400px;
                max-height: 85vh;
                overflow-y: auto;
                background: var(--bg);
                color: var(--text);
                padding: 15px;
                border-radius: 12px;
                z-index: 999999;
                font-family: Arial, sans-serif;
                box-shadow: 0 6px 30px rgba(0,0,0,0.7);
                user-select: none;
            }
            #panel-header {
                cursor: move;
                margin-bottom: 12px;
                font-size: 16px;
                text-align: center;
                padding: 8px 0;
                background: var(--header-bg);
                border-radius: 8px;
            }
            #mediago-panel ul { list-style: none; padding: 0; margin: 0; }
            #mediago-panel li {
                margin: 12px 0;
                padding: 12px;
                background: var(--sub-bg);
                border-radius: 8px;
                word-break: break-all;
                position: relative;
            }
            #mediago-panel button {
                background: var(--button-bg);
                color: black;
                border: none;
                padding: 8px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: bold;
            }
            #mediago-panel button:hover { background: var(--button-hover); }
            #batch-send { background: #ff9900; }
            #batch-send:hover { background: #cc7700; }
            #select-all { background: #666; }
            #select-all:hover { background: #555; }
            .checkbox { position: absolute; top: 12px; left: 12px; }
        `);
        document.body.appendChild(panel);
 
        applyTheme();
 
        // 拖动功能
        const header = document.getElementById('panel-header');
        let isDragging = false, offsetX, offsetY;
        header.addEventListener('mousedown', e => {
            if (e.target.tagName === 'SPAN') return;
            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (isDragging) {
                panel.style.left = (e.clientX - offsetX) + 'px';
                panel.style.top = (e.clientY - offsetY) + 'px';
                panel.style.right = 'auto';
            }
        });
        document.addEventListener('mouseup', () => isDragging = false);
 
        // 主题切换
        document.getElementById('theme-toggle').addEventListener('click', () => {
            if (theme === 'auto') theme = 'dark';
            else if (theme === 'dark') theme = 'light';
            else theme = 'auto';
            GM_setValue('theme', theme);
            applyTheme();
            document.getElementById('theme-toggle').textContent = theme === 'light' ? '☀️' : '🌙';
        });
 
        // 设置按钮（隐私安全版）
        document.getElementById('settings-btn').addEventListener('click', () => {
            const current = GM_getValue('mediago_url', '');
            const newUrl = prompt('请输入你的 MediaGo 地址', current);
            if (newUrl === null) return; // 取消
            if (newUrl.trim() !== '') {
                MEDIAGO_URL = newUrl.trim().replace(/\/+$/, '');
                GM_setValue('mediago_url', MEDIAGO_URL);
                alert('MediaGo 地址已保存！下次使用将生效');
            } else {
                alert('地址不能为空！');
            }
        });
 
        // 模式切换
        panel.querySelectorAll('input[name="mode"]').forEach(radio => {
            radio.addEventListener('change', e => {
                mode = e.target.value;
                GM_setValue('mode', mode);
            });
        });
 
        // 全选 & 批量投喂
        document.getElementById('select-all').addEventListener('click', () => {
            const allChecked = panel.querySelectorAll('input[type="checkbox"]').length === panel.querySelectorAll('input[type="checkbox"]:checked').length;
            panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = !allChecked);
        });
 
        document.getElementById('batch-send').addEventListener('click', () => {
            const selected = panel.querySelectorAll('input[type="checkbox"]:checked');
            if (selected.length === 0) return alert('请先选中要投喂的 m3u8');
            if (selected.length > 10) return alert('一次最多批量投喂 10 个，避免卡顿');
 
            const urls = Array.from(selected).map(cb => cb.dataset.url);
            batchSend(urls);
        });
    }
 
    // 添加 m3u8 到面板（带复选框）
    function addM3u8(url) {
        if (detectedM3u8.has(url) || !url.toLowerCase().includes('.m3u8')) return;
        detectedM3u8.add(url);
 
        if (!panel) createPanel();
 
        const li = document.createElement('li');
        li.innerHTML = `
            <input type="checkbox" class="checkbox" data-url="${url}">
            <div style="margin-left:35px;font-size:13px;margin-bottom:8px;">${url.length > 100 ? url.substring(0, 100) + '...' : url}</div>
            <button data-url="${url}">投喂 NAS</button>
            <div style="clear:both;"></div>
        `;
        document.getElementById('m3u8-list').prepend(li);
 
        li.querySelector('button').addEventListener('click', e => {
            e.stopPropagation();
            sendToMediaGo(url);
        });
    }
 
    // 智能获取文件名（弹窗 + 自动序号）
    function getSmartName(baseTitle, callback) {
        const userInput = prompt(`请输入文件名（可不填自动序号）\n原标题：${baseTitle}`, baseTitle);
        let finalName;
        if (userInput === null) return; // 取消
        if (userInput.trim() === '') {
            if (!counter[baseTitle]) counter[baseTitle] = 0;
            counter[baseTitle]++;
            finalName = counter[baseTitle] === 1 ? baseTitle : `${baseTitle} (${counter[baseTitle]})`;
        } else {
            finalName = userInput.trim();
        }
        GM_setValue('counter', counter);
        callback(finalName);
    }
 
    // 单个投喂
    function sendToMediaGo(m3u8Url) {
        const baseTitle = document.title.trim() || '未知视频';
        getSmartName(baseTitle, name => {
            if (!name) return;
            executeSend(m3u8Url, name);
        });
    }
 
    // 批量投喂
    function batchSend(urls) {
        const baseTitle = document.title.trim() || '批量视频';
        const prefix = prompt(`批量投喂 ${urls.length} 个视频\n请输入文件名前缀（可不填）`, baseTitle);
        if (prefix === null) return;
 
        let index = 1;
        urls.forEach(url => {
            const name = prefix ? `${prefix.trim()} (${index++})` : `视频 ${index++}`;
            setTimeout(() => executeSend(url, name), (index - 1) * 300); // 错开请求
        });
        alert(`已开始批量投喂 ${urls.length} 个任务！`);
    }
 
    // 执行投喂（双模式）
    function executeSend(m3u8Url, finalName) {
        if (mode === 'api') {
            const task = { name: finalName, url: m3u8Url, type: 'm3u8', folder: '' };
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${MEDIAGO_URL}/api/download-now`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(task),
                onload: r => alert(r.status >= 200 && r.status < 300 ? `🎉 纯 API 成功：${finalName}` : `❌ API 失败：${r.status}`),
                onerror: () => alert('❌ API 请求错误')
            });
        } else {
            const headersStr = 'Referer:*';
            const taskUrl = `${MEDIAGO_URL}/?n=true&name=${encodeURIComponent(finalName)}&url=${encodeURIComponent(m3u8Url)}&headers=${encodeURIComponent(headersStr)}&type=m3u8&silent=true`;
            window.open(taskUrl, '_blank');
            alert(`🔗 已打开 MediaGo 预填页面：${finalName}`);
        }
    }
 
    // 嗅探 XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && url.toLowerCase().includes('.m3u8')) {
            const fullUrl = new URL(url, location.href).href;
            addM3u8(fullUrl);
        }
        origOpen.apply(this, arguments);
    };
 
    // 嗅探 fetch
    const origFetch = window.fetch;
    window.fetch = function(resource, options) {
        let urlStr = typeof resource === 'string' ? resource : (resource && resource.url) || '';
        if (typeof urlStr === 'string' && urlStr.toLowerCase().includes('.m3u8')) {
            const fullUrl = new URL(urlStr, location.href).href;
            addM3u8(fullUrl);
        }
        return origFetch.apply(this, arguments);
    };
 
    // 系统主题变化监听
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
 
})();
