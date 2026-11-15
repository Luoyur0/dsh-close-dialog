(() => {
  const out = { ok: false };
  try {
    if (globalThis.__dshCloseHook) { out.ok = true; out.already = true; return JSON.stringify(out); }
    const M = process.mainModule;
    const req = (M && typeof M.require === 'function') ? M.require.bind(M) : require;
    const { app, dialog, BrowserWindow } = req('electron');
    const path = req('node:path');
    const fs = require('node:fs');

    const HOOK_DIR = __HOOK_DIR__;
    const useNative = (() => {
      try { return fs.existsSync(path.join(HOOK_DIR, 'native-dialog')); } catch (_) { return false; }
    })();
    out.mode = useNative ? 'native' : 'custom';

    // 预置官方"已确认后台运行"标记，避免官方一次性提示与本对话框叠加。
    const markers = new Set();
    const ensureMarker = () => {
      try {
        const marker = path.join(app.getPath('userData'), 'background-close-confirmed');
        if (markers.has(marker)) return;
        markers.add(marker);
        if (!fs.existsSync(marker)) {
          fs.mkdirSync(path.dirname(marker), { recursive: true });
          fs.writeFileSync(marker, '');
        }
        out.marker = marker;
      } catch (e) { out.markerError = String(e && e.message); }
    };

    // 渲染进程里画卡片：DOM + CSSOM 逐条赋值（不注入 <style> 字符串，绕开页面 CSP）。
    const rendererUI = function () {
      return new Promise(function (resolve) {
        var HOST_ID = '__dsh_close_overlay__';
        var old = document.getElementById(HOST_ID);
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var settled = false;
        var host = document.createElement('div');
        host.id = HOST_ID;
        var hs = host.style;
        hs.position = 'fixed';
        hs.left = '0'; hs.top = '0'; hs.right = '0'; hs.bottom = '0';
        hs.display = 'flex'; hs.alignItems = 'center'; hs.justifyContent = 'center';
        hs.zIndex = '2147483647';
        hs.background = 'rgba(8, 9, 14, 0.55)';
        hs.fontFamily = '"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",system-ui,sans-serif';
        hs.opacity = '0';
        hs.transition = 'opacity 110ms ease';
        host.addEventListener('mousedown', function (e) { e.stopPropagation(); }, true);
        host.addEventListener('contextmenu', function (e) { e.preventDefault(); });

        var card = document.createElement('div');
        var cs = card.style;
        cs.boxSizing = 'border-box';
        cs.width = '420px';
        cs.maxWidth = 'calc(100vw - 56px)';
        cs.background = '#23232f';
        cs.border = '1px solid rgba(224, 189, 126, 0.55)';
        cs.borderRadius = '16px';
        cs.padding = '24px 24px 12px';
        cs.boxShadow = '0 24px 64px rgba(0,0,0,0.55)';
        cs.color = '#eef0f6';
        cs.transform = 'scale(0.97)';
        cs.transition = 'transform 110ms ease, opacity 110ms ease';

        var title = document.createElement('div');
        title.textContent = '退出 DeepSeek Harness';
        var ts = title.style;
        ts.fontSize = '19px'; ts.fontWeight = '600'; ts.letterSpacing = '0.2px'; ts.color = '#f4f5fa';
        ts.lineHeight = '1.3';

        var desc = document.createElement('div');
        desc.textContent = '后台运行时窗口会隐藏到系统托盘，任务完成后会发通知。';
        var ds = desc.style;
        ds.marginTop = '10px'; ds.fontSize = '12.5px'; ds.lineHeight = '1.7'; ds.color = '#9fa2b3';

        var list = document.createElement('div');
        var ls = list.style;
        ls.marginTop = '20px'; ls.display = 'flex'; ls.flexDirection = 'column'; ls.gap = '10px';

        function applyStyle(el, obj) {
          for (var k in obj) el.style[k] = obj[k];
        }
        function mkBtn(label, spec) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          var bs = b.style;
          bs.appearance = 'none';
          bs.webkitAppearance = 'none';
          bs.boxSizing = 'border-box';
          bs.width = '100%';
          bs.height = '38px';
          bs.margin = '0';
          bs.padding = '0';
          bs.borderRadius = '9px';
          bs.fontSize = '13.5px';
          bs.fontFamily = 'inherit';
          bs.fontWeight = '500';
          bs.letterSpacing = '0.2px';
          bs.cursor = 'pointer';
          bs.outline = 'none';
          bs.transition = 'background 110ms ease, border-color 110ms ease, color 110ms ease';
          applyStyle(b, spec.base);
          if (spec.hover) {
            b.addEventListener('mouseenter', function () { applyStyle(b, spec.hover); });
            b.addEventListener('mouseleave', function () { applyStyle(b, spec.base); });
          }
          b.__choice = spec.choice;
          b.addEventListener('click', function () { finish(spec.choice); });
          return b;
        }

        var trayBase = { background: '#2b3352', border: '1px solid #46579c', color: '#c8d3f5' };
        var quitBase = { background: '#3a2531', border: '1px solid #7d3b48', color: '#ff8091' };
        var trayBtn = mkBtn('最小化到托盘', { choice: 'tray', base: trayBase, hover: { background: '#333d63', border: '1px solid #5c6fbd', color: '#dde5ff' } });
        var quitBtn = mkBtn('退出应用', { choice: 'quit', base: quitBase, hover: { background: '#482c3a', border: '1px solid #9a4a59', color: '#ff9aa8' } });
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = '取消';
        var xb = cancelBtn.style;
        xb.appearance = 'none'; xb.webkitAppearance = 'none';
        xb.boxSizing = 'border-box'; xb.width = '100%'; xb.height = '32px'; xb.marginTop = '2px';
        xb.margin = '2px 0 0 0'; xb.padding = '0';
        xb.background = 'transparent'; xb.border = '1px solid transparent'; xb.borderRadius = '9px';
        xb.color = '#8a8d9c'; xb.fontSize = '13px'; xb.fontFamily = 'inherit'; xb.fontWeight = '400';
        xb.cursor = 'pointer'; xb.outline = 'none';
        cancelBtn.addEventListener('mouseenter', function () { xb.color = '#b9bccb'; xb.background = 'rgba(255,255,255,0.04)'; });
        cancelBtn.addEventListener('mouseleave', function () { xb.color = '#8a8d9c'; xb.background = 'transparent'; });
        cancelBtn.__choice = 'cancel';
        cancelBtn.addEventListener('click', function () { finish('cancel'); });

        list.appendChild(trayBtn);
        list.appendChild(quitBtn);
        list.appendChild(cancelBtn);
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(list);
        host.appendChild(card);

        var buttons = [trayBtn, quitBtn, cancelBtn];

        function finish(choice) {
          if (settled) return;
          settled = true;
          window.removeEventListener('keydown', onKey, true);
          hs.opacity = '0';
          cs.opacity = '0';
          setTimeout(function () {
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(choice);
          }, 100);
        }

        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); return; }
          if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            var el = document.activeElement;
            finish((el && el.__choice) || 'tray');
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault(); e.stopPropagation();
            var idx = buttons.indexOf(document.activeElement);
            var next = e.shiftKey ? (idx <= 0 ? buttons.length - 1 : idx - 1) : (idx === buttons.length - 1 ? 0 : idx + 1);
            buttons[next].focus();
          }
        }
        window.addEventListener('keydown', onKey, true);

        var parent = document.body || document.documentElement;
        parent.appendChild(host);
        requestAnimationFrame(function () {
          hs.opacity = '1';
          cs.opacity = '1';
          cs.transform = 'scale(1)';
        });
        setTimeout(function () { try { trayBtn.focus(); } catch (_) {} }, 30);
      });
    };

    function nativeDialog(win) {
      let choice = 2;
      try {
        choice = dialog.showMessageBoxSync(win, {
          type: 'none',
          title: '退出 DeepSeek Harness',
          message: '退出 DeepSeek Harness',
          detail: '后台运行时窗口会隐藏到系统托盘，任务完成后会发系统通知。',
          buttons: ['最小化到托盘', '退出应用', '取消'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
      } catch (e) {
        out.dialogError = String(e && e.message);
        return null;
      }
      return choice === 0 ? 'tray' : choice === 1 ? 'quit' : 'cancel';
    }

    const closing = new WeakSet();
    let attached = 0;
    let overlays = 0;

    const askAndAct = (win, doHide) => {
      if (win.__dshCloseAsking) return;
      win.__dshCloseAsking = true;
      const release = () => { win.__dshCloseAsking = false; };
      const act = (choice) => {
        release();
        if (choice === 'tray') doHide();
        else if (choice === 'quit') setTimeout(() => app.quit(), 0);
      };
      const wc = win.webContents;
      const usable = wc && !wc.isDestroyed() && !useNative;
      if (!usable) {
        const choice = nativeDialog(win);
        if (choice) act(choice); else release();
        return;
      }
      let done = false;
      const settle = (choice) => {
        if (done) return;
        done = true;
        try { wc.removeListener('render-process-gone', onGone); } catch (_) {}
        if (choice) act(choice); else release();
      };
      const onGone = () => {
        if (done) return;
        settle(nativeDialog(win));
      };
      wc.once('render-process-gone', onGone);
      overlays += 1;
      out.overlays = overlays;
      wc.executeJavaScript('(' + rendererUI.toString() + ')()', true).then((choice) => {
        settle(choice === 'quit' ? 'quit' : choice === 'cancel' ? 'cancel' : 'tray');
      }).catch((e) => {
        out.overlayError = String(e && e.message);
        settle(nativeDialog(win));
      });
    };

    const attach = (win) => {
      if (!win || win.__dshCloseHookAttached) return;
      win.__dshCloseHookAttached = true;
      win.prependListener('close', () => {
        closing.add(win);
        setTimeout(() => closing.delete(win), 4000);
      });
      attached += 1;
      ensureMarker();
    };
    for (const w of BrowserWindow.getAllWindows()) attach(w);
    app.on('browser-window-created', (_e, w) => attach(w));
    if (app.isReady()) ensureMarker(); else app.whenReady().then(ensureMarker).catch(() => {});

    const origHide = BrowserWindow.prototype.hide;
    BrowserWindow.prototype.hide = function (...args) {
      if (!closing.has(this)) return origHide.apply(this, args);
      closing.delete(this);
      askAndAct(this, () => origHide.apply(this, args));
    };

    globalThis.__dshCloseHook = { installedAt: Date.now(), attached, mode: out.mode };
    out.attached = attached;
    out.ok = true;
    return JSON.stringify(out);
  } catch (err) {
    out.error = String((err && err.stack) || err);
    return JSON.stringify(out);
  }
})()
