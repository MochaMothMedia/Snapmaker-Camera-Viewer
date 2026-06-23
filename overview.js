const grid = document.getElementById('grid');
const boots = document.getElementById('boots');
const send = (m) => browser.runtime.sendMessage(m);

let printers = [];

// Per-printer runtime state.
const state = {}; // ip -> { errors, backoff, nextBootAt, visible, fetching }

function initState(ip) {
	state[ip] = { errors: 0, backoff: 0, nextBootAt: 0, visible: false, fetching: false };
}

async function init() {
	const s = await browser.storage.local.get("u1Printers");
	printers = s.u1Printers || [];
	if (!printers.length) {
		grid.innerHTML = '<div class="empty">No printers configured. Open Settings to add some.</div>';
		return;
	}
	printers.forEach(p => { initState(p.ip); buildCell(p); loadBootstrap(p.ip); });
	setupObserver();
	// Single ticking loop; each printer decides whether it's due for work.
	setInterval(loop, 1000);
}

function buildCell(p) {
	const cell = document.createElement('div');
	cell.className = "cell";
	cell.dataset.ip = p.ip;
	cell.innerHTML =
		`<div class="bar"><span>${p.name || p.ip}</span><span class="st wait" data-st>…</span></div>
		 <img data-img alt="">`;
	cell.querySelector('[data-img]').addEventListener('click', () => {
		browser.storage.local.get("u1Printers").then(({ u1Printers }) => {
			const i = (u1Printers || []).findIndex(x => x.ip === p.ip);
			browser.runtime.sendMessage({ type: "openPage", page: `viewer.html#${i}` });
		});
	});
	grid.appendChild(cell);
}

// ---- Visibility: pause fetch + wake for off-screen tiles ----
function setupObserver() {
	const io = new IntersectionObserver((entries) => {
		for (const e of entries) {
			const ip = e.target.dataset.ip;
			const st = state[ip];
			if (!st) continue;
			const nowVisible = e.isIntersecting;
			if (nowVisible && !st.visible) {
				st.visible = true;
				send({ type: "startWake", ip });          // resume keepalive
			} else if (!nowVisible && st.visible) {
				st.visible = false;
				send({ type: "stopWake", ip });           // pause keepalive
				setStat(ip, "paused", "wait");
			}
		}
	}, { root: null, threshold: 0.1 });
	grid.querySelectorAll('.cell').forEach(c => io.observe(c));
}

function loadBootstrap(ip) {
	let f = boots.querySelector(`iframe[data-ip="${ip}"]`);
	if (!f) { f = document.createElement('iframe'); f.dataset.ip = ip; f.referrerPolicy = "no-referrer"; boots.appendChild(f); }
	f.src = `http://${ip}/`;
}

// Re-bootstrap with exponential backoff (stale token -> quick recovery;
// truly offline -> backs off so we don't hammer).
function maybeReBoot(ip) {
	const st = state[ip];
	const now = Date.now();
	if (now < st.nextBootAt) return;
	// backoff: 0s, 8s, 16s, 32s ... capped at 5 min
	const delay = Math.min(8000 * Math.pow(2, st.backoff), 300000);
	st.nextBootAt = now + delay;
	st.backoff++;
	loadBootstrap(ip);
}

function setStat(ip, text, cls) {
	const cell = grid.querySelector(`.cell[data-ip="${ip}"]`);
	if (!cell) return;
	const st = cell.querySelector('[data-st]');
	st.textContent = text; st.className = "st " + cls;
}

async function loop() {
	await Promise.all(printers.map(async (p) => {
		const st = state[p.ip];
		if (!st || !st.visible || st.fetching) return;  // skip hidden / in-flight
		st.fetching = true;
		try {
			const res = await send({ type: "frame", ip: p.ip });
			const cell = grid.querySelector(`.cell[data-ip="${p.ip}"]`);
			if (!cell) return;
			const img = cell.querySelector('[data-img]');
			if (res && res.ok) {
				img.src = res.dataUrl;
				st.errors = 0; st.backoff = 0; st.nextBootAt = 0;  // healthy: reset recovery
				setStat(p.ip, "live", "ok");
			} else {
				st.errors++;
				if (st.errors > 3) {
					setStat(p.ip, st.backoff > 2 ? "offline?" : "reconnecting…", st.backoff > 2 ? "err" : "wait");
					maybeReBoot(p.ip);   // silent token-refresh attempt, backed off
				} else {
					setStat(p.ip, "…", "wait");
				}
			}
		} finally {
			st.fetching = false;
		}
	}));
}

document.getElementById('settings').addEventListener('click', () => browser.runtime.sendMessage({ type: "openPage", page: "options.html" }));

init();
