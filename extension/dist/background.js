chrome.runtime.onInstalled.addListener(() => {
	console.log("🌌 PIXEL NOVA Background Service Worker Initialized");
}), chrome.action.onClicked.addListener(async (e) => {
	if (e.id) try {
		await chrome.sidePanel.open({ tabId: e.id });
	} catch (e) {
		console.error("Failed to open side panel:", e);
	}
}), chrome.commands?.onCommand !== void 0 && chrome.commands.onCommand.addListener(async (e) => {
	if (e === "toggle-nova-voice") try {
		let e = await chrome.tabs.query({
			active: !0,
			currentWindow: !0
		});
		(!e || e.length === 0 || !e[0]?.id) && (e = await chrome.tabs.query({
			active: !0,
			lastFocusedWindow: !0
		}));
		let t = e?.[0], n = t?.windowId;
		if (await chrome.storage.local.set({ autoStartVoice: Date.now() }), n && typeof chrome.sidePanel?.open == "function") try {
			await chrome.sidePanel.open({ windowId: n });
		} catch {
			if (t?.id) try {
				await chrome.sidePanel.open({ tabId: t.id });
			} catch {}
		}
		setTimeout(() => {
			chrome.runtime.sendMessage({ type: "ACTIVATE_VOICE_LISTENER" }).catch(() => {});
		}, 350);
	} catch (e) {
		console.error("Error handling toggle-nova-voice hotkey:", e);
	}
});
var e = {
	irctc: "https://www.irctc.co.in/nget/",
	railway: "https://www.irctc.co.in/nget/",
	railways: "https://www.irctc.co.in/nget/",
	makemytrip: "https://www.makemytrip.com",
	mmt: "https://www.makemytrip.com",
	goibibo: "https://www.goibibo.com",
	redbus: "https://www.redbus.in",
	ixigo: "https://www.ixigo.com",
	easemytrip: "https://www.easemytrip.com",
	uber: "https://m.uber.com",
	ola: "https://www.olacabs.com",
	digilocker: "https://www.digilocker.gov.in",
	uidai: "https://myaadhaar.uidai.gov.in",
	aadhaar: "https://myaadhaar.uidai.gov.in",
	aadhar: "https://myaadhaar.uidai.gov.in",
	incometax: "https://www.incometax.gov.in/iec/foportal/",
	itr: "https://www.incometax.gov.in/iec/foportal/",
	parivahan: "https://parivahan.gov.in",
	vahan: "https://parivahan.gov.in",
	sarathi: "https://parivahan.gov.in",
	passport: "https://www.passportindia.gov.in",
	epfo: "https://www.epfindia.gov.in",
	pf: "https://www.epfindia.gov.in",
	cowin: "https://www.cowin.gov.in",
	upsc: "https://upsc.gov.in",
	indiapost: "https://www.indiapost.gov.in",
	postoffice: "https://www.indiapost.gov.in",
	voters: "https://voters.eci.gov.in",
	nvsp: "https://voters.eci.gov.in",
	kiet: "https://www.kiet.edu",
	aktu: "https://aktu.ac.in",
	leetcode: "https://leetcode.com",
	geeksforgeeks: "https://www.geeksforgeeks.org",
	gfg: "https://www.geeksforgeeks.org",
	hackerrank: "https://www.hackerrank.com",
	codeforces: "https://codeforces.com",
	codechef: "https://www.codechef.com",
	coursera: "https://www.coursera.org",
	udemy: "https://www.udemy.com",
	swayam: "https://swayam.gov.in",
	nptel: "https://nptel.ac.in",
	stackoverflow: "https://stackoverflow.com",
	w3schools: "https://www.w3schools.com",
	arxiv: "https://arxiv.org",
	zomato: "https://www.zomato.com",
	swiggy: "https://www.swiggy.com",
	blinkit: "https://www.blinkit.com",
	zepto: "https://www.zepto.com",
	bigbasket: "https://www.bigbasket.com",
	dominos: "https://pizzaonline.dominos.co.in",
	mcdonalds: "https://mcdelivery.co.in",
	bookmyshow: "https://in.bookmyshow.com",
	bms: "https://in.bookmyshow.com",
	hotstar: "https://www.hotstar.com",
	primevideo: "https://www.primevideo.com",
	jiocinema: "https://www.jiocinema.com",
	sonyliv: "https://www.sonyliv.com",
	zee5: "https://www.zee5.com",
	cricbuzz: "https://www.cricbuzz.com",
	espn: "https://www.espncricinfo.com",
	netflix: "https://www.netflix.com",
	spotify: "https://open.spotify.com",
	youtube: "https://www.youtube.com",
	gaana: "https://gaana.com",
	jiosaavn: "https://www.jiosaavn.com",
	wynk: "https://wynk.in/music",
	soundcloud: "https://soundcloud.com",
	applemusic: "https://music.apple.com",
	amazon: "https://www.amazon.in",
	flipkart: "https://www.flipkart.com",
	myntra: "https://www.myntra.com",
	meesho: "https://www.meesho.com",
	nykaa: "https://www.nykaa.com",
	ajio: "https://www.ajio.com",
	target: "https://www.target.com",
	walmart: "https://www.walmart.com",
	bestbuy: "https://www.bestbuy.com",
	ebay: "https://www.ebay.com",
	sbi: "https://www.onlinesbi.sbi",
	onlinesbi: "https://www.onlinesbi.sbi",
	hdfc: "https://netbanking.hdfcbank.com",
	icici: "https://www.icicibank.com",
	axis: "https://www.axisbank.com",
	kotak: "https://www.kotak.com",
	zerodha: "https://kite.zerodha.com",
	groww: "https://groww.in",
	paytm: "https://paytm.com",
	phonepe: "https://www.phonepe.com",
	google: "https://www.google.com",
	wikipedia: "https://www.wikipedia.org",
	github: "https://www.github.com",
	reddit: "https://www.reddit.com",
	twitter: "https://x.com",
	x: "https://x.com",
	linkedin: "https://www.linkedin.com",
	instagram: "https://www.instagram.com",
	insta: "https://www.instagram.com",
	facebook: "https://www.facebook.com",
	fb: "https://www.facebook.com",
	whatsapp: "https://web.whatsapp.com",
	telegram: "https://web.telegram.org",
	gmail: "https://mail.google.com",
	chatgpt: "https://chatgpt.com",
	openai: "https://chatgpt.com",
	gemini: "https://gemini.google.com",
	claude: "https://claude.ai",
	canva: "https://www.canva.com",
	notion: "https://www.notion.so",
	figma: "https://www.figma.com",
	drive: "https://drive.google.com"
};
function t(t) {
	let n = t.trim();
	if (/^https?:\/\//i.test(n)) return n;
	let r = n.toLowerCase();
	return e[r] ? e[r] : /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?(\/.*)?$/.test(n) ? `https://${n}` : /^[a-zA-Z0-9_-]+$/.test(n) && n.length >= 3 ? `https://www.${r}.com` : `https://www.google.com/search?q=${encodeURIComponent(n)}`;
}
function n(e, t = 12e3) {
	return new Promise((n) => {
		let r = null, i = (t, r) => {
			t === e && r.status === "complete" && (a(), n(!0));
		}, a = () => {
			r && clearTimeout(r), chrome.tabs.onUpdated.removeListener(i);
		};
		r = setTimeout(() => {
			a(), n(!1);
		}, t), chrome.tabs.onUpdated.addListener(i);
	});
}
chrome.runtime.onMessage.addListener((e, r, i) => e?.type === "CAPTURE_SCREENSHOT" ? (chrome.tabs.captureVisibleTab({ format: "png" }, (e) => {
	chrome.runtime.lastError || !e ? i({
		success: !1,
		error: chrome.runtime.lastError?.message || "Failed to capture tab"
	}) : i({
		success: !0,
		dataUrl: e
	});
}), !0) : e?.type === "NAVIGATE_TAB" ? ((async () => {
	try {
		let r = t(e.url || "https://www.google.com"), a = await chrome.tabs.query({
			active: !0,
			currentWindow: !0
		});
		(!a || a.length === 0 || !a[0]?.id) && (a = await chrome.tabs.query({
			active: !0,
			lastFocusedWindow: !0
		}));
		let o, s = a?.[0];
		!s?.id || s.url?.startsWith("chrome://") || s.url?.startsWith("edge://") ? o = (await chrome.tabs.create({
			url: r,
			active: !0
		})).id : (o = s.id, await chrome.tabs.update(o, { url: r })), await n(o, 14e3), await new Promise((e) => setTimeout(e, 800));
		try {
			await chrome.scripting.executeScript({
				target: { tabId: o },
				files: ["content.js"]
			});
		} catch {}
		i({
			success: !0,
			url: r,
			tabId: o
		});
	} catch (e) {
		console.error("Navigation error:", e), i({
			success: !1,
			error: e.message || "Failed to navigate"
		});
	}
})(), !0) : e?.type === "HISTORY_NAVIGATE" ? ((async () => {
	try {
		let t = await chrome.tabs.query({
			active: !0,
			currentWindow: !0
		});
		(!t || t.length === 0 || !t[0]?.id) && (t = await chrome.tabs.query({
			active: !0,
			lastFocusedWindow: !0
		}));
		let r = e.tabId || t?.[0]?.id;
		if (!r) {
			i({
				success: !1,
				direction: e.direction,
				error: "No active browser tab found"
			});
			return;
		}
		let a = e.direction === "forward" ? "forward" : "back";
		a === "back" ? await chrome.tabs.goBack(r) : await chrome.tabs.goForward(r), await n(r, 1e4), await new Promise((e) => setTimeout(e, 800));
		try {
			await chrome.scripting.executeScript({
				target: { tabId: r },
				files: ["content.js"]
			});
		} catch {}
		i({
			success: !0,
			direction: a,
			url: (await chrome.tabs.get(r)).url,
			tabId: r
		});
	} catch (t) {
		console.warn("History navigation notice:", t), i({
			success: !1,
			direction: e.direction,
			error: t.message?.includes("Cannot navigate") || t.message?.includes("history") ? `At the ${e.direction === "forward" ? "latest page (cannot go forward further)" : "beginning of tab history (cannot go back further)"}.` : t.message || "Failed to navigate history"
		});
	}
})(), !0) : e?.type === "DISPATCH_REAL_CLICK" || e?.action === "DISPATCH_REAL_CLICK" ? ((async () => {
	let t = e.tabId || r.tab?.id;
	if (t ||= (await chrome.tabs.query({
		active: !0,
		currentWindow: !0
	}))[0]?.id, !t) {
		i({
			success: !1,
			error: "No active tab for real click"
		});
		return;
	}
	let n = { tabId: t };
	try {
		try {
			await chrome.debugger.attach(n, "1.3");
		} catch (e) {
			if (!e?.message?.includes("Already attached")) throw e;
		}
		let t = Math.round(e.x), r = Math.round(e.y), a = e.clickCount || 1;
		await chrome.debugger.sendCommand(n, "Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: t,
			y: r
		});
		for (let e = 1; e <= a; e++) await chrome.debugger.sendCommand(n, "Input.dispatchMouseEvent", {
			type: "mousePressed",
			x: t,
			y: r,
			button: "left",
			buttons: 1,
			clickCount: e
		}), await new Promise((e) => setTimeout(e, 50)), await chrome.debugger.sendCommand(n, "Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: t,
			y: r,
			button: "left",
			buttons: 0,
			clickCount: e
		}), e < a && await new Promise((e) => setTimeout(e, 60));
		i({
			success: !0,
			isTrusted: !0,
			x: t,
			y: r,
			clickCount: a
		});
	} catch (e) {
		console.error("CDP Real Click error:", e), i({
			success: !1,
			error: e?.message || String(e)
		});
	} finally {
		try {
			await chrome.debugger.detach(n);
		} catch {}
	}
})(), !0) : !1);
//#endregion
