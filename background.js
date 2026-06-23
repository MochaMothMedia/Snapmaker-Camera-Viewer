const activeWake = new Set();        // ips we keep awake
const wakeStatus = {};               // ip -> last known wake ok/fail

// ===========================================================================
// Register the content script for a printer's pages (per granted IP)
// ===========================================================================
async function registerWakeScript(ip) {
	const id = "u1-wake-" + ip.replace(/[^0-9a-zA-Z]/g, "_");
	try {
		// Remove any prior registration for this id, then add fresh.
		try { await browser.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) {}
		await browser.scripting.registerContentScripts([{
			id,
			js: ["wake-content.js"],
			matches: [`http://${ip}/*`],
			runAt: "document_idle",
			allFrames: true,
			persistAcrossSessions: false
		}]);
	} catch (e) {
		console.warn("[U1] registerContentScripts failed for", ip, e);
	}
}

// Open an extension page, reusing an existing extension tab if one is open.
async function openExtensionPage(page) {
	const url = browser.runtime.getURL(page);
	const base = browser.runtime.getURL("");           // moz-extension://<id>/
	try {
		const tabs = await browser.tabs.query({});
		const mine = tabs.find(t => t.url && t.url.startsWith(base));
		if (mine) {
			await browser.tabs.update(mine.id, { url, active: true });
			try { await browser.windows.update(mine.windowId, { focused: true }); } catch (e) {}
			return;
		}
	} catch (e) { /* fall through to create */ }
	browser.tabs.create({ url });
}

async function unregisterWakeScript(ip) {
	const id = "u1-wake-" + ip.replace(/[^0-9a-zA-Z]/g, "_");
	try { await browser.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) {}
}

// On startup, register scripts for all stored printers.
async function reinstallAllScripts() {
	const { u1Printers } = await browser.storage.local.get("u1Printers");
	for (const p of (u1Printers || [])) await registerWakeScript(p.ip);
}
reinstallAllScripts();

// ===========================================================================
// Hidden iframe host: load the printer page so the content script runs there
// ===========================================================================
// The background script (persistent background page in Firefox MV3) has a DOM,
// so it can hold hidden iframes. We point one at each active printer's root.

function bootHost(ip) {
	const existing = document.querySelector(`iframe[data-u1ip="${ip}"]`);
	if (existing) {
		// Reload to re-trigger the content script / refresh a stale session.
		existing.src = `http://${ip}/?u1=${Date.now()}`;
		return;
	}
	const f = document.createElement("iframe");
	f.dataset.u1ip = ip;
	f.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;";
	f.referrerPolicy = "no-referrer";
	// Set src as real markup the loader sees (avoids Firefox all_frames
	// injection gaps with programmatic srcless iframes).
	f.src = `http://${ip}/`;
	document.body.appendChild(f);
}

function teardownHost(ip) {
	const f = document.querySelector(`iframe[data-u1ip="${ip}"]`);
	if (f) f.remove();
}

// ===========================================================================
// Snapshot fetch (with cheap change signature for staleness detection)
// ===========================================================================
async function fetchFrame(ip) {
	const url = `http://${ip}/server/files/camera/monitor.jpg?t=${Date.now()}`;
	const resp = await fetch(url, { cache: "no-store" });
	if (!resp.ok) throw new Error("HTTP " + resp.status);
	const buf = await resp.arrayBuffer();
	const bytes = new Uint8Array(buf);

	let h = 0x811c9dc5;
	const step = Math.max(1, Math.floor(bytes.length / 4096));
	for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
	const sig = (bytes.length >>> 0).toString(16) + ":" + (h >>> 0).toString(16);

	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return { dataUrl: "data:image/jpeg;base64," + btoa(binary), sig };
}

// ===========================================================================
// Message API
// ===========================================================================
browser.runtime.onMessage.addListener((msg, sender) => {
	switch (msg.type) {
		case "frame":
			return fetchFrame(msg.ip)
				.then(r => ({ ok: true, ...r }))
				.catch(e => ({ ok: false, error: String(e) }));

		case "startWake":
			activeWake.add(msg.ip);
			registerWakeScript(msg.ip);   // ensure content script is registered
			bootHost(msg.ip);             // load the page so it runs
			return Promise.resolve({ ok: true });

		case "stopWake":
			activeWake.delete(msg.ip);
			teardownHost(msg.ip);
			return Promise.resolve({ ok: true });

		case "registerScript":
			return registerWakeScript(msg.ip).then(() => ({ ok: true }));

		case "removeScript":
			return unregisterWakeScript(msg.ip).then(() => ({ ok: true }));

	case "openPage":
			return openExtensionPage(msg.page).then(() => ({ ok: true }));

		// Reported by the content script after each wake attempt.
		case "wakeResult": {
			// Identify which printer this came from via the sender's frame URL.
			let ip = null;
			try { ip = new URL(sender.url).hostname; } catch (e) {}
			if (ip) wakeStatus[ip] = { ok: !!msg.ok, at: Date.now(), error: msg.error };
			return Promise.resolve({ ok: true });
		}

		case "wakeStatus":
			return Promise.resolve({ ok: true, status: wakeStatus[msg.ip] || null });
	}
});

// ===========================================================================
// Health watchdog: if a host's last wake is stale/failed, reload its iframe
// ===========================================================================
setInterval(() => {
	const now = Date.now();
	for (const ip of activeWake) {
		const s = wakeStatus[ip];
		// No report in ~20s, or last report failed -> reload the host page.
		if (!s || (now - s.at) > 20000 || !s.ok) {
			bootHost(ip);
		}
	}
}, 15000);

// ===========================================================================
// Toolbar + install
// ===========================================================================
browser.action.onClicked.addListener(async () => {
	const { u1Printers } = await browser.storage.local.get("u1Printers");
	await openExtensionPage(u1Printers && u1Printers.length ? "viewer.html" : "options.html");
});

browser.runtime.onInstalled.addListener(({ reason }) => {
	if (reason === "install") browser.runtime.openOptionsPage();
});
