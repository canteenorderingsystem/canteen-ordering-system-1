(() => {
    "use strict";

    const API_BASE = (() => {
        const { protocol, host, origin } = window.location;
        const isHttp = protocol === "http:" || protocol === "https:";
        // Served by Spring Boot (localhost, LAN IP, or Render's HTTPS proxy) —
        // keep using the same origin so the API always lives where the page does.
        return isHttp && host ? origin : "http://localhost:8080";
    })();

    const ENDPOINTS = {
        orders: `${API_BASE}/api/orders`
    };

    const $ = (id) => document.getElementById(id);

    const els = {
        clockTime: $("clockTime"),
        clockDate: $("clockDate"),
        liveStatus: $("liveStatus"),
        liveLabel: $("liveLabel"),
        soundBtn: $("soundBtn"),
        refreshBtn: $("refreshBtn"),
        fullscreenBtn: $("fullscreenBtn"),
        lastUpdated: $("lastUpdated"),
        nextQueue: $("nextQueue"),
        statActive: $("statActive"),
        statPending: $("statPending"),
        statPreparing: $("statPreparing"),
        statReady: $("statReady"),
        statServed: $("statServed"),
        statusTabs: $("statusTabs"),
        searchInput: $("searchInput"),
        ordersGrid: $("ordersGrid"),
        toast: $("kToast"),
        toastText: $("kToastText")
    };

    const TABS = [
        { key: "ACTIVE", label: "Active" },
        { key: "PENDING", label: "Pending" },
        { key: "PREPARING", label: "Preparing" },
        { key: "READY", label: "Ready" },
        { key: "COMPLETED", label: "Served" },
        { key: "CANCELLED", label: "Cancelled" },
        { key: "ALL", label: "All" }
    ];

    const ACTIVE_STATUSES = ["PENDING", "PREPARING", "READY"];

    const NEXT_STATUS = {
        PENDING: "PREPARING",
        PREPARING: "READY",
        READY: "COMPLETED"
    };

    const ACTION_LABEL = {
        PENDING: "Start preparing",
        PREPARING: "Mark ready",
        READY: "Complete"
    };

    const STATUS_MESSAGE = {
        PREPARING: "is now being prepared",
        READY: "is ready for pickup",
        COMPLETED: "is completed",
        CANCELLED: "was cancelled"
    };

    const SOUND_KEY = "kainna-kitchen-sound";

    const state = {
        orders: [],
        filter: "ACTIVE",
        search: "",
        soundOn: false,
        knownIds: new Set(),
        highlights: new Map(),
        firstLoad: true,
        fetching: false,
        hasLoaded: false,
        lastError: "",
        offlineNotified: false,
        connected: null,
        lastSignature: null
    };

    let audioContext = null;
    let toastTimer = null;

    /* ------------------------------------------------------------------
       Helpers
       ------------------------------------------------------------------ */

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => {
            switch (character) {
                case "&": return "&amp;";
                case "<": return "&lt;";
                case ">": return "&gt;";
                case '"': return "&quot;";
                case "'": return "&#39;";
                default: return character;
            }
        });
    }

    function money(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return "₱0.00";
        return "₱" + amount.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function ordinal(number) {
        const value = Number(number) || 0;
        const mod100 = value % 100;
        if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
        switch (value % 10) {
            case 1: return `${value}st`;
            case 2: return `${value}nd`;
            case 3: return `${value}rd`;
            default: return `${value}th`;
        }
    }

    function statusLabel(status) {
        return status.charAt(0) + status.slice(1).toLowerCase();
    }

    function relativeTime(isoDate) {
        const timestamp = new Date(isoDate).getTime();
        if (!Number.isFinite(timestamp)) return "";

        const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
        if (seconds < 45) return "just now";

        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes} min ago`;

        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ${minutes % 60}m ago`;

        return `${Math.floor(hours / 24)}d ago`;
    }

    function clockTime(isoDate) {
        const date = new Date(isoDate);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    }

    async function api(url, options = {}) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 12000);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                    ...(options.body ? { "Content-Type": "application/json" } : {}),
                    ...(options.headers || {})
                }
            });

            if (!response.ok) {
                let message = `Request failed (${response.status}).`;
                try {
                    const error = await response.json();
                    if (error && error.message) message = error.message;
                } catch {
                    /* Not JSON. */
                }
                throw new Error(message);
            }

            if (response.status === 204) return null;
            return await response.json();
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("The server took too long to respond.");
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    /* ------------------------------------------------------------------
       Toast, clock & connection
       ------------------------------------------------------------------ */

    function showToast(message, type = "info") {
        els.toastText.textContent = message;
        els.toast.className = "k-toast is-visible";
        if (type) els.toast.classList.add(`k-toast-${type}`);

        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            els.toast.classList.remove("is-visible");
        }, 3800);
    }

    function tickClock() {
        const now = new Date();
        els.clockTime.textContent = now.toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit"
        });
        els.clockDate.textContent = now.toLocaleDateString("en-PH", {
            weekday: "short",
            month: "short",
            day: "numeric"
        });
    }

    function setConnection(online) {
        const previous = state.connected;
        state.connected = online;

        els.liveStatus.classList.toggle("is-offline", !online);
        els.liveLabel.textContent = online ? "Live" : "Offline";

        if (online && previous === false) {
            showToast("Back online — orders are live.", "success");
        }
    }

    /* ------------------------------------------------------------------
       Sound
       ------------------------------------------------------------------ */

    function ensureAudio() {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;

        try {
            if (!audioContext) audioContext = new AudioCtor();
            if (audioContext.state === "suspended") {
                audioContext.resume().catch(() => {});
            }
            return audioContext;
        } catch {
            return null;
        }
    }

    function playChime() {
        if (!state.soundOn) return;
        const context = ensureAudio();
        if (!context) return;

        try {
            const start = context.currentTime;
            [880, 1174.7].forEach((frequency, index) => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                const at = start + index * 0.13;

                oscillator.type = "sine";
                oscillator.frequency.value = frequency;

                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(0.11, at + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);

                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start(at);
                oscillator.stop(at + 0.3);
            });
        } catch {
            /* Audio is a nice-to-have. */
        }
    }

    function updateSoundButton() {
        els.soundBtn.classList.toggle("is-on", state.soundOn);
        els.soundBtn.setAttribute("aria-pressed", String(state.soundOn));
        els.soundBtn.title = state.soundOn ? "Mute new-order sound" : "Enable new-order sound";
    }

    function initSound() {
        try {
            state.soundOn = window.localStorage.getItem(SOUND_KEY) === "on";
        } catch {
            state.soundOn = false;
        }

        updateSoundButton();

        els.soundBtn.addEventListener("click", () => {
            state.soundOn = !state.soundOn;

            try {
                window.localStorage.setItem(SOUND_KEY, state.soundOn ? "on" : "off");
            } catch {
                /* Storage might be unavailable. */
            }

            updateSoundButton();

            if (state.soundOn) {
                ensureAudio();
                playChime();
                showToast("New-order sound is on.", "success");
            } else {
                showToast("New-order sound is off.", "info");
            }
        });
    }

    /* ------------------------------------------------------------------
       Tabs & stats
       ------------------------------------------------------------------ */

    function buildTabs() {
        els.statusTabs.innerHTML = TABS.map((tab) => `
            <button class="k-tab${tab.key === state.filter ? " is-active" : ""}"
                    type="button" role="tab"
                    data-filter="${tab.key}"
                    aria-selected="${tab.key === state.filter}"
                    aria-controls="ordersGrid"
                    tabindex="${tab.key === state.filter ? 0 : -1}">
                ${tab.label}
                <span class="k-tab-count" data-count-for="${tab.key}">0</span>
            </button>`).join("");

        updateTabs();
    }

    function computeCounts() {
        const counts = {
            ACTIVE: 0,
            PENDING: 0,
            PREPARING: 0,
            READY: 0,
            COMPLETED: 0,
            CANCELLED: 0,
            ALL: state.orders.length
        };

        state.orders.forEach((order) => {
            if (counts[order.status] !== undefined) counts[order.status] += 1;
            if (ACTIVE_STATUSES.includes(order.status)) counts.ACTIVE += 1;
        });

        return counts;
    }

    function updateTabs() {
        const counts = computeCounts();

        els.statusTabs.querySelectorAll("[data-filter]").forEach((tab) => {
            const key = tab.dataset.filter;
            const isActive = key === state.filter;

            tab.classList.toggle("is-active", isActive);
            tab.setAttribute("aria-selected", String(isActive));
            tab.tabIndex = isActive ? 0 : -1;

            const count = tab.querySelector("[data-count-for]");
            if (count) count.textContent = String(counts[key] ?? 0);
        });
    }

    function updateStats() {
        const counts = computeCounts();

        els.statActive.textContent = String(counts.ACTIVE);
        els.statPending.textContent = String(counts.PENDING);
        els.statPreparing.textContent = String(counts.PREPARING);
        els.statReady.textContent = String(counts.READY);
        els.statServed.textContent = String(counts.COMPLETED);

        const queueNumbers = state.orders
            .map((order) => Number(order.queueNumber))
            .filter((number) => Number.isFinite(number));

        const next = queueNumbers.length > 0 ? Math.max(...queueNumbers) + 1 : 1;
        els.nextQueue.textContent = `#${next}`;
    }

    /* ------------------------------------------------------------------
       Loading & rendering
       ------------------------------------------------------------------ */

    function renderLoading() {
        els.ordersGrid.setAttribute("aria-busy", "true");
        els.ordersGrid.innerHTML = '<div class="k-skeleton-card" aria-hidden="true"></div>'.repeat(6);
    }

    function renderAll() {
        updateStats();
        updateTabs();
        renderOrders();
        els.ordersGrid.setAttribute("aria-busy", "false");
    }

    function visibleOrders() {
        let orders = state.orders.filter((order) => {
            if (state.filter === "ACTIVE") return ACTIVE_STATUSES.includes(order.status);
            if (state.filter === "ALL") return true;
            return order.status === state.filter;
        });

        const query = state.search.trim().toLowerCase().replace(/^#/, "");
        if (query) {
            orders = orders.filter((order) => {
                const haystack = [
                    order.queueNumber,
                    order.customerName,
                    order.notes,
                    ...(order.items || []).map((item) => item.name)
                ].join(" ").toLowerCase();
                return haystack.includes(query);
            });
        }

        return orders.sort((first, second) => first.queueNumber - second.queueNumber);
    }

    function renderOrders() {
        if (!state.hasLoaded) return;

        const orders = visibleOrders();

        if (orders.length === 0) {
            els.ordersGrid.innerHTML = emptyState();
            return;
        }

        els.ordersGrid.innerHTML = orders.map(orderCard).join("");
    }

    function orderCard(order) {
        const status = order.status || "PENDING";
        const statusClass = status.toLowerCase();
        const queue = Number(order.queueNumber) || 0;
        const paddedQueue = String(queue).padStart(2, "0");
        const customer = order.customerName || "Guest";
        const initial = Array.from(customer.trim())[0]?.toUpperCase() || "G";
        const hue = (queue * 47) % 360;
        const items = Array.isArray(order.items) ? order.items : [];
        const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const notes = order.notes
            ? `<p class="k-note">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                       <path d="M5 6h14v9H9l-4 4V6Z"/>
                   </svg>
                   ${escapeHtml(order.notes)}
               </p>`
            : "";

        const isNew = (state.highlights.get(order.id) || 0) > Date.now();
        const nextStatus = NEXT_STATUS[status];

        const itemsMarkup = items.map((item) => `
            <li class="k-item">
                <span class="k-item-qty">${Number(item.quantity)}×</span>
                <span class="k-item-name">${escapeHtml(item.name)}</span>
                <span class="k-item-price">${money(item.lineTotal ?? Number(item.unitPrice) * Number(item.quantity))}</span>
            </li>`).join("");

        const actionMarkup = nextStatus
            ? `<div class="k-order-actions">
                   <button class="k-cancel" type="button"
                           data-action="CANCELLED"
                           data-id="${Number(order.id)}"
                           data-queue="${queue}"
                           aria-label="Cancel order for queue ${queue}"
                           title="Cancel order">
                       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" aria-hidden="true">
                           <path d="m6 6 12 12M18 6 6 18"/>
                       </svg>
                   </button>
                   <button class="k-action" type="button"
                           data-action="${nextStatus}"
                           data-id="${Number(order.id)}"
                           data-queue="${queue}">
                       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                           ${status === "PENDING"
                               ? '<path d="M8 5.5v13l10-6.5-10-6.5Z"/>'
                               : '<path d="m5 12 4.5 4.5L19 7"/>'}
                       </svg>
                       ${ACTION_LABEL[status]}
                   </button>
               </div>`
            : `<span class="k-served-stamp">
                   ${status === "COMPLETED" ? "Served" : "Cancelled"}
                   ${clockTime(order.updatedAt || order.createdAt)}
               </span>`;

        return `
            <article class="k-order is-${statusClass}${isNew ? " is-new" : ""}" data-id="${Number(order.id)}">
                <header class="k-order-head">
                    <div class="k-queue">
                        <span class="k-queue-number">${paddedQueue}</span>
                        <div>
                            <span class="k-queue-label">${ordinal(queue)} customer</span>
                            <span class="k-order-ref">Order #${Number(order.id)}</span>
                        </div>
                    </div>
                    <div class="k-order-badges">
                        ${isNew ? '<span class="k-new-pill">New</span>' : ""}
                        <span class="k-status k-status-${statusClass}">${statusLabel(status)}</span>
                    </div>
                </header>

                <div class="k-customer">
                    <span class="k-avatar" style="--avatar-hue: ${hue}" aria-hidden="true">${escapeHtml(initial)}</span>
                    <div class="k-customer-info">
                        <strong>${escapeHtml(customer)}</strong>
                        <span>Placed ${clockTime(order.createdAt)}</span>
                    </div>
                    <span class="k-time" data-created="${escapeHtml(order.createdAt)}">${relativeTime(order.createdAt)}</span>
                </div>

                ${notes}

                <div class="k-items-wrap">
                    <div class="k-items-head">
                        <span>Items</span>
                        <span>${itemCount} ${itemCount === 1 ? "pc" : "pcs"}</span>
                    </div>
                    <ul class="k-items">
                        ${itemsMarkup || '<li class="k-item"><span class="k-item-qty">—</span><span class="k-item-name">No items</span><span class="k-item-price"></span></li>'}
                    </ul>
                </div>

                <footer class="k-order-footer">
                    <div class="k-order-total">
                        <span>Total</span>
                        <strong>${money(order.totalAmount)}</strong>
                    </div>
                    ${actionMarkup}
                </footer>
            </article>`;
    }

    function emptyState() {
        const searching = state.search.trim() !== "";

        let emoji = "🧾";
        let title = "No orders yet";
        let copy = "Place an order from the student menu and it will show up here in seconds.";

        if (searching) {
            emoji = "🔎";
            title = "No matching orders";
            copy = `Nothing matches “${state.search.trim()}”. Try a queue number, name or item.`;
        } else if (state.filter === "ACTIVE") {
            emoji = "🥣";
            title = "All caught up";
            copy = "No active orders right now. New orders will appear here automatically.";
        } else if (state.filter === "COMPLETED") {
            emoji = "🍽️";
            title = "Nothing served yet";
            copy = "Completed orders will be archived here for your records.";
        } else if (state.filter === "CANCELLED") {
            emoji = "✅";
            title = "No cancellations";
            copy = "Cancelled orders will appear here.";
        } else if (state.filter === "PENDING") {
            emoji = "⏳";
            title = "No pending orders";
            copy = "New tickets waiting to be started will land here.";
        } else if (state.filter === "PREPARING") {
            emoji = "🔥";
            title = "Nothing on the line";
            copy = "Orders you start preparing will show up here.";
        } else if (state.filter === "READY") {
            emoji = "🛎️";
            title = "No orders waiting for pickup";
            copy = "Orders marked ready will wait here until they are collected.";
        }

        return `
            <div class="k-empty">
                <span class="k-empty-icon" aria-hidden="true">${emoji}</span>
                <h2>${title}</h2>
                <p>${searching ? escapeHtml(copy) : copy}</p>
            </div>`;
    }

    function errorState(message) {
        return `
            <div class="k-empty">
                <span class="k-empty-icon" aria-hidden="true">🔌</span>
                <h2>Kitchen server offline</h2>
                <p>${escapeHtml(message)} Make sure the Spring Boot app is running on port 8080.</p>
                <button type="button" data-retry-orders>Try again</button>
            </div>`;
    }

    /* ------------------------------------------------------------------
       Fetching orders
       ------------------------------------------------------------------ */

    function cleanupHighlights() {
        const now = Date.now();
        state.highlights.forEach((expiresAt, id) => {
            if (expiresAt <= now) {
                state.highlights.delete(id);
                const card = els.ordersGrid.querySelector(`.k-order[data-id="${id}"]`);
                if (card) {
                    card.classList.remove("is-new");
                    card.querySelector(".k-new-pill")?.remove();
                }
            }
        });
    }

    function updateRelativeTimes() {
        els.ordersGrid.querySelectorAll(".k-time[data-created]").forEach((element) => {
            element.textContent = relativeTime(element.dataset.created);
        });
    }

    function detectNewOrders(orders) {
        if (state.firstLoad) {
            state.knownIds = new Set(orders.map((order) => order.id));
            state.firstLoad = false;
            return;
        }

        const fresh = orders.filter((order) => !state.knownIds.has(order.id));

        fresh.forEach((order) => {
            state.knownIds.add(order.id);
            if (order.status === "PENDING") {
                state.highlights.set(order.id, Date.now() + 9000);
            }
        });

        if (fresh.length > 0) {
            if (fresh.length === 1) {
                showToast(`New order · Queue #${fresh[0].queueNumber} incoming`, "new");
            } else {
                showToast(`${fresh.length} new orders received`, "new");
            }
            playChime();
        }
    }

    function signatureOf(orders) {
        return JSON.stringify(orders.map((order) => [order.id, order.status, order.updatedAt]));
    }

    async function loadOrders({ silent = false } = {}) {
        if (state.fetching) return;
        state.fetching = true;

        if (!state.hasLoaded) renderLoading();

        try {
            const orders = await api(ENDPOINTS.orders);
            const list = Array.isArray(orders) ? orders : [];

            detectNewOrders(list);
            cleanupHighlights();

            state.orders = list;
            state.hasLoaded = true;
            state.lastError = "";
            state.offlineNotified = false;
            setConnection(true);

            const signature = signatureOf(list);
            if (signature !== state.lastSignature) {
                state.lastSignature = signature;
                renderAll();
            }

            els.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString("en-PH", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            })}`;
        } catch (error) {
            setConnection(false);
            els.lastUpdated.textContent = "Reconnecting…";

            if (!state.hasLoaded) {
                state.lastError = error.message;
                els.ordersGrid.setAttribute("aria-busy", "false");
                els.ordersGrid.innerHTML = errorState(error.message);
            }

            if (!state.offlineNotified) {
                showToast("Can't reach the kitchen server — retrying…", "error");
                state.offlineNotified = true;
            }
        } finally {
            state.fetching = false;
        }
    }

    async function updateStatus(order, status, button) {
        button.disabled = true;
        button.classList.add("is-busy");

        try {
            const updated = await api(`${ENDPOINTS.orders}/${order.id}/status`, {
                method: "PATCH",
                body: JSON.stringify({ status })
            });

            order.status = updated.status;
            order.updatedAt = updated.updatedAt;

            if (status === "COMPLETED" || status === "CANCELLED") {
                state.highlights.delete(order.id);
            }

            showToast(
                `Queue #${order.queueNumber} ${STATUS_MESSAGE[status] || "was updated"}.`,
                status === "CANCELLED" ? "error" : "success"
            );

            state.lastSignature = null;
            renderAll();
            loadOrders({ silent: true });
        } catch (error) {
            showToast(error.message || "Couldn't update the order.", "error");
            button.disabled = false;
            button.classList.remove("is-busy");
        }
    }

    /* ------------------------------------------------------------------
       Events
       ------------------------------------------------------------------ */

    function bindEvents() {
        els.statusTabs.addEventListener("click", (event) => {
            const tab = event.target.closest("[data-filter]");
            if (!tab) return;

            state.filter = tab.dataset.filter;
            updateTabs();
            renderOrders();
        });

        els.statusTabs.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

            const tabs = Array.from(els.statusTabs.querySelectorAll(".k-tab"));
            const currentIndex = tabs.indexOf(document.activeElement);
            if (currentIndex === -1) return;

            event.preventDefault();
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
            tabs[nextIndex].focus();
            tabs[nextIndex].click();
        });

        els.searchInput.addEventListener("input", () => {
            state.search = els.searchInput.value;
            renderOrders();
        });

        els.ordersGrid.addEventListener("click", (event) => {
            const button = event.target.closest("[data-action]");
            if (!button) return;

            const id = Number(button.dataset.id);
            const status = button.dataset.action;
            const order = state.orders.find((entry) => entry.id === id);
            if (!order) return;

            if (status === "CANCELLED" && !window.confirm(`Cancel queue #${order.queueNumber}? This can't be undone.`)) {
                return;
            }

            updateStatus(order, status, button);
        });

        document.addEventListener("click", (event) => {
            if (event.target.closest("[data-retry-orders]")) {
                loadOrders();
            }
        });

        els.refreshBtn.addEventListener("click", async () => {
            if (els.refreshBtn.classList.contains("is-spinning")) return;

            els.refreshBtn.classList.add("is-spinning");
            await loadOrders({ silent: true });
            window.setTimeout(() => els.refreshBtn.classList.remove("is-spinning"), 450);
        });

        els.fullscreenBtn.addEventListener("click", async () => {
            try {
                if (!document.fullscreenElement) {
                    await document.documentElement.requestFullscreen();
                } else {
                    await document.exitFullscreen();
                }
            } catch {
                showToast("Fullscreen isn't available in this browser.", "error");
            }
        });

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) loadOrders({ silent: true });
        });
    }

    function init() {
        bindEvents();
        buildTabs();
        initSound();
        tickClock();
        window.setInterval(tickClock, 1000);

        loadOrders();
        window.setInterval(() => {
            if (!document.hidden) loadOrders({ silent: true });
        }, 5000);
        window.setInterval(updateRelativeTimes, 20000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
