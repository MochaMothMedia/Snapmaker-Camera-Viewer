const nameEl = document.getElementById('name');
const ipEl = document.getElementById('ip');
const listEl = document.getElementById('list');
const msg = document.getElementById('msg');

function setMsg(t, c) { msg.textContent = t; msg.className = c || ''; }
function normalizeIp(v) { return v.trim().replace(/^\w+:\/\//, "").replace(/\/.*$/, ""); }

async function getPrinters() {
	const { u1Printers } = await browser.storage.local.get("u1Printers");
	return u1Printers || [];
}
async function setPrinters(p) { await browser.storage.local.set({ u1Printers: p }); }

async function hostPerms(ip) {
	return { origins: [`http://${ip}/*`, `ws://${ip}/*`] };
}

async function render() {
	const printers = await getPrinters();
	listEl.innerHTML = "";
	for (const p of printers) {
		const granted = await browser.permissions.contains(await hostPerms(p.ip));
		const li = document.createElement('li');
		const nm = document.createElement('input');
		nm.className = "name"; nm.value = p.name || ""; nm.placeholder = "(unnamed)";
		nm.addEventListener('change', async () => {
			const all = await getPrinters();
			const t = all.find(x => x.ip === p.ip); if (t) t.name = nm.value;
			await setPrinters(all);
		});
		const ipSpan = document.createElement('span');
		ipSpan.className = "ip"; ipSpan.textContent = p.ip + (granted ? "" : "  ⚠ not authorized");
		if (!granted) ipSpan.classList.add('grant');

		const del = document.createElement('button');
		del.className = "danger"; del.textContent = "Remove";
		del.addEventListener('click', async () => {
			const all = (await getPrinters()).filter(x => x.ip !== p.ip);
			await setPrinters(all);
			try { await browser.permissions.remove(await hostPerms(p.ip)); } catch (e) {}
			render();
		});
		li.append(nm, ipSpan, del);
		listEl.appendChild(li);
	}
}

document.getElementById('add').addEventListener('click', async () => {
	const ip = normalizeIp(ipEl.value);
	if (!ip) { setMsg("Enter an IP.", "err"); return; }

	// FIRST thing, no await before it — request both schemes.
	let granted;
	try {
		granted = await browser.permissions.request({
			origins: [`http://${ip}/*`, `ws://${ip}/*`]
		});
	} catch (e) {
		setMsg("Permission request failed: " + e.message, "err");
		return;
	}
	if (!granted) {
		setMsg("Permission denied for " + ip + " — can't access it without granting access.", "err");
		return; // do NOT save a printer we can't reach
	}

	// Only now do async work + save.
	const printers = await getPrinters();
	if (printers.some(p => p.ip === ip)) { setMsg("That IP is already added.", "err"); return; }
	printers.push({ ip, name: nameEl.value.trim() });
	await setPrinters(printers);
	browser.runtime.sendMessage({ type: "registerScript", ip });
	nameEl.value = ""; ipEl.value = "";
	setMsg("Added " + ip + " ✓", "ok");
	render();
});

document.getElementById('viewer').addEventListener('click', () => browser.runtime.sendMessage({ type: "openPage", page: "viewer.html" }));
document.getElementById('overview').addEventListener('click', () => browser.runtime.sendMessage({ type: "openPage", page: "overview.html" }));

ipEl.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('add').click(); });
render();
