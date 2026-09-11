chrome.runtime.onInstalled.addListener(() => {
	console.log("🌌 PIXEL NOVA Background Service Worker Initialized");
}), chrome.action.onClicked.addListener(async (e) => {
	if (e.id) try {
		await chrome.sidePanel.open({ tabId: e.id });
	} catch (e) {
		console.error("Failed to open side panel:", e);
	}
});
function e(e) {
	let t = e.trim();
	if (/^https?:\/\//i.test(t)) return t;
	let n = t.toLowerCase();
	return n === "spotify" ? "https://open.spotify.com" : n === "youtube" ? "https://www.youtube.com" : n === "gaana" ? "https://gaana.com" : n === "jiosaavn" ? "https://www.jiosaavn.com" : n === "wynk" ? "https://wynk.in/music" : n === "soundcloud" ? "https://soundcloud.com" : n === "amazon" ? "https://www.amazon.in" : n === "flipkart" ? "https://www.flipkart.com" : n === "myntra" ? "https://www.myntra.com" : n === "meesho" ? "https://www.meesho.com" : n === "nykaa" ? "https://www.nykaa.com" : n === "ajio" ? "https://www.ajio.com" : n === "google" ? "https://www.google.com" : n === "target" ? "https://www.target.com" : n === "walmart" ? "https://www.walmart.com" : n === "bestbuy" ? "https://www.bestbuy.com" : n === "ebay" ? "https://www.ebay.com" : n === "netflix" ? "https://www.netflix.com" : n === "github" ? "https://www.github.com" : n === "reddit" ? "https://www.reddit.com" : n === "wikipedia" ? "https://www.wikipedia.org" : n === "cricbuzz" ? "https://www.cricbuzz.com" : n === "twitter" || n === "x" ? "https://x.com" : n === "linkedin" ? "https://www.linkedin.com" : /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?(\/.*)?$/.test(t) ? `https://${t}` : /^[a-zA-Z0-9_-]+$/.test(t) && t.length >= 3 ? `https://www.${n}.com` : `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}
function t(e, t = 12e3) {
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
chrome.runtime.onMessage.addListener((n, r, i) => n?.type === "CAPTURE_SCREENSHOT" ? (chrome.tabs.captureVisibleTab({ format: "png" }, (e) => {
	chrome.runtime.lastError || !e ? i({
		success: !1,
		error: chrome.runtime.lastError?.message || "Failed to capture tab"
	}) : i({
		success: !0,
		dataUrl: e
	});
}), !0) : n?.type === "NAVIGATE_TAB" ? ((async () => {
	try {
		let r = e(n.url || "https://www.google.com"), a = await chrome.tabs.query({
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
		})).id : (o = s.id, await chrome.tabs.update(o, { url: r })), await t(o, 14e3), await new Promise((e) => setTimeout(e, 800));
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
})(), !0) : n?.type === "DISPATCH_REAL_CLICK" || n?.action === "DISPATCH_REAL_CLICK" ? ((async () => {
	let e = n.tabId || r.tab?.id;
	if (e ||= (await chrome.tabs.query({
		active: !0,
		currentWindow: !0
	}))[0]?.id, !e) {
		i({
			success: !1,
			error: "No active tab for real click"
		});
		return;
	}
	let t = { tabId: e };
	try {
		try {
			await chrome.debugger.attach(t, "1.3");
		} catch (e) {
			if (!e?.message?.includes("Already attached")) throw e;
		}
		let e = Math.round(n.x), r = Math.round(n.y);
		await chrome.debugger.sendCommand(t, "Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: e,
			y: r
		}), await chrome.debugger.sendCommand(t, "Input.dispatchMouseEvent", {
			type: "mousePressed",
			x: e,
			y: r,
			button: "left",
			buttons: 1,
			clickCount: 1
		}), await new Promise((e) => setTimeout(e, 60)), await chrome.debugger.sendCommand(t, "Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: e,
			y: r,
			button: "left",
			buttons: 0,
			clickCount: 1
		}), i({
			success: !0,
			isTrusted: !0,
			x: e,
			y: r
		});
	} catch (e) {
		console.error("CDP Real Click error:", e), i({
			success: !1,
			error: e?.message || String(e)
		});
	} finally {
		try {
			await chrome.debugger.detach(t);
		} catch {}
	}
})(), !0) : !1);
//#endregion
