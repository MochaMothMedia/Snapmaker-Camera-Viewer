const frame = document.getElementById('frame');
const placeholder = document.getElementById('placeholder');
const statusEl = document.getElementById('status');
const picker = document.getElementById('picker');
const boot = document.getElementById('boot');
const consoleWrap = document.getElementById('consoleWrap');
const consoleFrame = document.getElementById('console');
const toggleBtn = document.getElementById('toggleConsole');

let printers = [], idx = 0, ip = null;
let imgTimer = null, consoleOn = false;
let errors = 0, backoff = 0, nextBootAt = 0;

function setStatus(t, c) { statusEl.textContent = t; statusEl.className = c || ''; }
const send = (m) => browser.runtime.sendMessage(m);

async function init() {
	const s = await browser.storage.local.get("u1Printers");
	printers = s.u1Printers || [];
	if (!printers.length) { setStatus("no printers — open Settings", "err"); placeholder.textContent = "No printers configured."; return; }
	picker.textContent = "";
	printers.forEach((p, i) => {
		const opt = document.createElement('option');
		opt.value = String(i);
		opt.textContent = p.name || p.ip;   // textContent: no markup interpretation
		picker.appendChild(opt);
	});
	const hashIdx = parseInt(location.hash.slice(1), 10);
	selectPrinter(Number.isInteger(hashIdx) ? hashIdx : 0);
}

async function selectPrinter(i) {
	stopFeed();
	idx = (i + printers.length) % printers.length;
	picker.value = String(idx);
	ip = printers[idx].ip;
	errors = 0; backoff = 0; nextBootAt = 0;
	setStatus("starting…", "wait");
	loadBootstrap();
	send({ type: "startWake", ip });
	startFeed();
}

function loadBootstrap() { boot.src = `http://${ip}/`; }

function maybeReBoot() {
	const now = Date.now();
	if (now < nextBootAt) return;
	const delay = Math.min(8000 * Math.pow(2, backoff), 300000);
	nextBootAt = now + delay;
	backoff++;
	loadBootstrap();
}

async function tick() {
	const myIp = ip;
	const res = await send({ type: "frame", ip: myIp });
	if (myIp !== ip) return;
	if (res && res.ok) {
		frame.src = res.dataUrl; frame.style.display = "block";
		placeholder.style.display = "none";
		errors = 0; backoff = 0; nextBootAt = 0;     // healthy: reset recovery
		setStatus("live · " + ip, "ok");
	} else {
		errors++;
		if (errors > 3) {
			setStatus(backoff > 2 ? "offline? · " + ip : "reconnecting…", backoff > 2 ? "err" : "wait");
			maybeReBoot();
		} else {
			setStatus("waiting for frame…", "wait");
		}
	}
}

function startFeed() {
	if (imgTimer) return;
	imgTimer = setInterval(tick, 15000);
	setTimeout(tick, 1000);
}
function stopFeed() {
	if (imgTimer) { clearInterval(imgTimer); imgTimer = null; }
	if (ip) send({ type: "stopWake", ip });
}

toggleBtn.addEventListener('click', () => {
	consoleOn = !consoleOn;
	if (consoleOn) {
		consoleFrame.src = `http://${ip}/`;
		consoleWrap.classList.add('show');
		document.body.classList.add('console-on');
		toggleBtn.textContent = "Hide console";
	} else {
		consoleWrap.classList.remove('show');
		document.body.classList.remove('console-on');
		toggleBtn.textContent = "Show console";
		consoleFrame.src = "about:blank";
	}
});

picker.addEventListener('change', () => selectPrinter(parseInt(picker.value, 10)));
document.getElementById('prev').addEventListener('click', () => selectPrinter(idx - 1));
document.getElementById('next').addEventListener('click', () => selectPrinter(idx + 1));
document.getElementById('settings').addEventListener('click', () => browser.runtime.sendMessage({ type: "openPage", page: "options.html" }));
document.getElementById('overview').addEventListener('click', () => browser.runtime.sendMessage({ type: "openPage", page: "overview.html" }));
window.addEventListener('beforeunload', stopFeed);

init();
