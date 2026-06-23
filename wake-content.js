// Runs in the printer page's own origin. Everything here is same-origin,
// so the WebSocket carries the real Origin and Moonraker accepts the upgrade.

(function () {
	// Avoid double-injection if the script runs more than once in a frame.
	if (window.__u1WakeInstalled) return;
	window.__u1WakeInstalled = true;

	async function wake() {
		try {
			// Same-origin relative fetch — page context, real Origin.
			const r = await fetch('/access/oneshot_token?t=' + Date.now(), { cache: 'no-store' });
			let token;
			const ct = r.headers.get('content-type') || '';
			if (ct.includes('application/json')) {
				const j = await r.json();
				token = (j && j.result) ? j.result : (typeof j === 'string' ? j : null);
			} else {
				token = (await r.text()).trim().replace(/^"|"$/g, '');
			}
			if (!token) throw new Error('no token');

			await new Promise((resolve) => {
				let done = false;
				const finish = (ok) => {
					if (done) return; done = true;
					try { browser.runtime.sendMessage({ type: 'wakeResult', ok }); } catch (e) {}
					resolve();
				};
				let ws;
				try {
					ws = new WebSocket(`ws://${location.host}/websocket?token=${token}`);
				} catch (e) { return finish(false); }
				ws.onopen = () => {
					try {
						ws.send(JSON.stringify({
							id: 1, jsonrpc: '2.0',
							method: 'camera.start_monitor',
							params: { domain: 'lan', interval: 0 }
						}));
					} catch (e) {}
					setTimeout(() => { try { ws.close(); } catch (e) {} finish(true); }, 600);
				};
				ws.onerror = () => finish(false);
				ws.onclose = () => finish(false);
				setTimeout(() => finish(false), 4000);
			});
		} catch (e) {
			try { browser.runtime.sendMessage({ type: 'wakeResult', ok: false, error: String(e) }); } catch (_) {}
		}
	}

	// Wake immediately on load, then on an interval while this frame lives.
	wake();
	setInterval(wake, 5000);

	// Allow the background to trigger an extra wake on demand.
	browser.runtime.onMessage.addListener((msg) => {
		if (msg && msg.type === 'doWake') wake();
	});
})();
