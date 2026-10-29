(() => {
    "use strict";

    /* ------------------------------------------------------------------
       Config & tiny helpers
       ------------------------------------------------------------------ */

    const API_BASE = (() => {
        const { protocol, host, origin } = window.location;
        const isHttp = protocol === "http:" || protocol === "https:";
        // Served by Spring Boot (localhost, LAN IP, or Render's HTTPS proxy) —
        // keep using the same origin so the API always lives where the page does.
        return isHttp && host ? origin : "http://localhost:8080";
    })();

    const ENDPOINTS = {
        menu: `${API_BASE}/api/menu`,
        orders: `${API_BASE}/api/orders`,
        network: `${API_BASE}/api/network-info`,
        qr: `${API_BASE}/api/qr?size=400`
    };

    const $ = (id) => document.getElementById(id);

    const els = {
        siteHeader: $("siteHeader"),
        cartTrigger: $("cartTrigger"),
        headerCartCount: $("headerCartCount"),
        qrImage: $("qrImage"),
        qrSkeleton: $("qrSkeleton"),
        qrUrl: $("qrUrl"),
        copyUrlBtn: $("copyUrlBtn"),
        qrNote: $("qrNote"),
        menuCount: $("menuCount"),
        categoryFilters: $("categoryFilters"),
        refreshMenuBtn: $("refreshMenuBtn"),
        menuGrid: $("menuGrid"),
        cartPanel: $("cartPanel"),
        cartBadge: $("cartBadge"),
        cartCloseBtn: $("cartCloseBtn"),
        cartItems: $("cartItems"),
        cartSubtotal: $("cartSubtotal"),
        cartTotal: $("cartTotal"),
        customerName: $("customerName"),
        orderNotes: $("orderNotes"),
        placeOrderBtn: $("placeOrderBtn"),
        placeOrderLabel: $("placeOrderLabel"),
        mobileCartBar: $("mobileCartBar"),
        mobileCount: $("mobileCount"),
        mobileTotal: $("mobileTotal"),
        mobileCartBtn: $("mobileCartBtn"),
        backdrop: $("backdrop"),
        successModal: $("successModal"),
        successCloseBtn: $("successCloseBtn"),
        successQueue: $("successQueue"),
        successOrdinal: $("successOrdinal"),
        successName: $("successName"),
        successItems: $("successItems"),
        successTotal: $("successTotal"),
        successDone: $("successDone"),
        toastStack: $("toastStack"),
        year: $("year")
    };

    const state = {
        menu: [],
        cart: [],
        category: "All",
        submitting: false,
        loadingMenu: true
    };

    const mobileQuery = window.matchMedia("(max-width: 1120px)");
    let lastFocusedElement = null;
    let cartTriggerElement = null;
    let revealObserver = null;

    const CATEGORY_EMOJI = {
        "Rice Meals": "🍚",
        Snacks: "🌭",
        Drinks: "🥤",
        Desserts: "🍧"
    };

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

    function categoryEmoji(category) {
        return CATEGORY_EMOJI[category] || "🍽️";
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
                    /* The response was not JSON. */
                }
                throw new Error(message);
            }

            if (response.status === 204) return null;
            return await response.json();
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("The server took too long to respond. Please try again.");
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    /* ------------------------------------------------------------------
       Toasts
       ------------------------------------------------------------------ */

    function toast(message, type = "info", duration = 3200) {
        if (!els.toastStack) return;

        while (els.toastStack.children.length >= 3) {
            els.toastStack.firstElementChild.remove();
        }

        const element = document.createElement("div");
        element.className = `toast toast-${type}`;

        const dot = document.createElement("span");
        dot.className = "toast-dot";
        dot.setAttribute("aria-hidden", "true");

        const text = document.createElement("p");
        text.textContent = message;

        element.append(dot, text);
        els.toastStack.appendChild(element);

        window.requestAnimationFrame(() => element.classList.add("is-visible"));
        window.setTimeout(() => {
            element.classList.remove("is-visible");
            element.addEventListener("transitionend", () => element.remove(), { once: true });
            window.setTimeout(() => element.remove(), 500);
        }, duration);
    }

    /* ------------------------------------------------------------------
       Menu
       ------------------------------------------------------------------ */

    function setMenuLoading() {
        state.loadingMenu = true;
        els.menuGrid.setAttribute("aria-busy", "true");
        els.menuCount.textContent = "Loading menu…";

        const skeleton = `
            <article class="food-card skeleton-card" aria-hidden="true">
                <div class="card-media skeleton"></div>
                <div class="skeleton-body">
                    <div class="skeleton skeleton-line title"></div>
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line short"></div>
                    <div class="skeleton skeleton-line footer"></div>
                </div>
            </article>`;

        els.menuGrid.innerHTML = skeleton.repeat(6);
    }

    async function loadMenu({ silent = false } = {}) {
        if (!silent) setMenuLoading();

        try {
            const menu = await api(ENDPOINTS.menu);
            state.menu = Array.isArray(menu) ? menu : [];
            state.loadingMenu = false;
            renderCategoryFilters();
            renderMenu();
        } catch (error) {
            state.menu = [];
            state.loadingMenu = false;
            renderCategoryFilters();
            els.menuGrid.setAttribute("aria-busy", "false");
            els.menuCount.textContent = "Menu unavailable";
            els.menuGrid.innerHTML = `
                <div class="empty-state">
                    <span class="empty-emoji" aria-hidden="true">🍽️</span>
                    <h3>We couldn't load the menu</h3>
                    <p>${escapeHtml(error.message)} Make sure the Spring Boot app is running on port 8080.</p>
                    <button class="btn btn-ghost" type="button" data-retry-menu>Try again</button>
                </div>`;

            if (silent) {
                toast(error.message, "error");
            }
        }
    }

    function renderCategoryFilters() {
        const categories = ["All", ...new Set(
            state.menu
                .map((item) => item.category)
                .filter((category) => typeof category === "string" && category.trim() !== "")
        )];

        if (!categories.includes(state.category)) {
            state.category = "All";
        }

        els.categoryFilters.innerHTML = categories.map((category) => `
            <button class="chip${category === state.category ? " is-active" : ""}"
                    type="button"
                    data-category="${escapeHtml(category)}"
                    aria-pressed="${category === state.category}">
                ${escapeHtml(category)}
            </button>`).join("");
    }

    function renderMenu() {
        const items = state.category === "All"
            ? state.menu
            : state.menu.filter((item) => item.category === state.category);

        els.menuGrid.setAttribute("aria-busy", "false");
        els.menuCount.textContent = `${items.length} ${items.length === 1 ? "dish" : "dishes"}`;

        if (items.length === 0) {
            const filtered = state.menu.length > 0;
            els.menuGrid.innerHTML = `
                <div class="empty-state">
                    <span class="empty-emoji" aria-hidden="true">${filtered ? "🥣" : "👩‍🍳"}</span>
                    <h3>${filtered ? "Nothing in this category yet" : "The kitchen is still cooking"}</h3>
                    <p>${filtered
                        ? "Try another category — there's plenty more on the menu."
                        : "Today's menu hasn't been posted yet. Check back in a moment."}</p>
                    ${filtered
                        ? '<button class="btn btn-ghost" type="button" data-category="All">Show everything</button>'
                        : '<button class="btn btn-ghost" type="button" data-retry-menu>Refresh menu</button>'}
                </div>`;
            return;
        }

        els.menuGrid.innerHTML = items.map((item, index) => foodCard(item, index)).join("");
        observeCards();
    }

    function foodCard(item, index) {
        const available = item.available !== false;
        const name = escapeHtml(item.name);
        const description = escapeHtml(item.description || "Freshly made for you.");
        const category = escapeHtml(item.category || "Today");
        const imageUrl = escapeHtml(item.imageUrl || "");
        const emoji = categoryEmoji(item.category);

        return `
            <article class="food-card reveal${available ? "" : " is-unavailable"}"
                     style="--reveal-delay: ${Math.min(index * 55, 330)}ms">
                <div class="card-media">
                    <img src="${imageUrl}" alt="${name}" loading="lazy"
                         onerror="this.classList.add('is-hidden'); this.parentElement.classList.add('media-failed')">
                    <span class="media-fallback" aria-hidden="true">${emoji}</span>
                    <span class="category-badge">${category}</span>
                    ${available ? "" : '<span class="sold-out-badge">Sold out</span>'}
                </div>
                <div class="card-body">
                    <div class="card-title-row">
                        <h3>${name}</h3>
                        <span class="price">${money(item.price)}</span>
                    </div>
                    <p class="card-desc">${description}</p>
                    <div class="card-footer">
                        <span class="prep-note">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="8.5"/>
                                <path d="M12 7.5V12l3 1.8"/>
                            </svg>
                            ~8 min
                        </span>
                        <button class="add-btn" type="button" data-add="${Number(item.id)}"
                                ${available ? "" : "disabled"}>
                            <span class="add-icon" aria-hidden="true">+</span>
                            ${available ? "Add to cart" : "Unavailable"}
                        </button>
                    </div>
                </div>
            </article>`;
    }

    function observeCards() {
        if (!("IntersectionObserver" in window)) {
            document.querySelectorAll(".food-card.reveal").forEach((card) => {
                card.classList.add("is-visible");
            });
            return;
        }

        if (!revealObserver) {
            revealObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        revealObserver.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });
        }

        document.querySelectorAll(".food-card.reveal:not(.is-visible)").forEach((card) => {
            revealObserver.observe(card);
        });
    }

    function flashAdded(button) {
        if (!button.dataset.originalHtml) {
            button.dataset.originalHtml = button.innerHTML;
        }

        button.classList.add("is-added");
        button.innerHTML = '<span class="add-icon" aria-hidden="true">✓</span> Added';

        window.clearTimeout(Number(button.dataset.timer));
        button.dataset.timer = String(window.setTimeout(() => {
            button.classList.remove("is-added");
            if (button.dataset.originalHtml) {
                button.innerHTML = button.dataset.originalHtml;
            }
        }, 1100));
    }

    /* ------------------------------------------------------------------
       Cart
       ------------------------------------------------------------------ */

    function addToCart(item) {
        if (!item || item.available === false) return;

        const existing = state.cart.find((line) => line.item.id === item.id);

        if (existing) {
            if (existing.quantity >= 20) {
                toast("You can add up to 20 of one item.", "error");
                return;
            }
            existing.quantity += 1;
        } else {
            state.cart.push({ item, quantity: 1 });
        }

        renderCart();
        pulseBadge();
    }

    function changeQuantity(itemId, delta) {
        const line = state.cart.find((entry) => entry.item.id === itemId);
        if (!line) return;

        const nextQuantity = line.quantity + delta;

        if (nextQuantity <= 0) {
            state.cart = state.cart.filter((entry) => entry.item.id !== itemId);
        } else if (nextQuantity > 20) {
            toast("You can add up to 20 of one item.", "error");
            return;
        } else {
            line.quantity = nextQuantity;
        }

        renderCart();
        pulseBadge();
    }

    function pulseBadge() {
        [els.headerCartCount, els.cartBadge].forEach((badge) => {
            if (!badge) return;
            badge.classList.remove("bump");
            void badge.offsetWidth;
            badge.classList.add("bump");
        });
    }

    function cartTotals() {
        const count = state.cart.reduce((sum, line) => sum + line.quantity, 0);
        const total = state.cart.reduce(
            (sum, line) => sum + Number(line.item.price) * line.quantity,
            0
        );
        return { count, total };
    }

    function renderCart() {
        const { count, total } = cartTotals();

        els.cartBadge.textContent = String(count);
        els.headerCartCount.textContent = String(count);
        els.cartSubtotal.textContent = money(total);
        els.cartTotal.textContent = money(total);
        els.mobileCount.textContent = `${count} ${count === 1 ? "item" : "items"}`;
        els.mobileTotal.textContent = money(total);

        els.mobileCartBar.classList.toggle("is-hidden", count === 0);

        if (state.cart.length === 0) {
            els.cartItems.innerHTML = `
                <div class="cart-empty">
                    <span class="empty-emoji" aria-hidden="true">🥡</span>
                    <strong>Your tray is empty</strong>
                    <p>Add something tasty from today's menu to get started.</p>
                </div>`;
        } else {
            els.cartItems.innerHTML = state.cart.map(({ item, quantity }) => {
                const emoji = categoryEmoji(item.category);
                return `
                    <div class="cart-item">
                        <div class="cart-thumb-wrap">
                            <span class="cart-thumb-fallback" aria-hidden="true">${emoji}</span>
                            <img class="cart-thumb"
                                 src="${escapeHtml(item.imageUrl || "")}"
                                 alt=""
                                 loading="lazy"
                                 onerror="this.style.display='none'">
                        </div>
                        <div class="cart-item-main">
                            <div class="cart-item-top">
                                <strong>${escapeHtml(item.name)}</strong>
                                <span class="cart-line-total">${money(Number(item.price) * quantity)}</span>
                            </div>
                            <div class="cart-item-bottom">
                                <span class="unit-price">${money(item.price)} each</span>
                                <div class="stepper" role="group" aria-label="Quantity for ${escapeHtml(item.name)}">
                                    <button type="button" data-cart="dec" data-id="${Number(item.id)}"
                                            aria-label="Remove one ${escapeHtml(item.name)}">−</button>
                                    <span aria-live="polite">${quantity}</span>
                                    <button type="button" data-cart="inc" data-id="${Number(item.id)}"
                                            aria-label="Add one ${escapeHtml(item.name)}">+</button>
                                </div>
                            </div>
                        </div>
                    </div>`;
            }).join("");
        }

        els.placeOrderBtn.disabled = state.submitting || state.cart.length === 0;
        els.placeOrderLabel.textContent = state.submitting ? "Placing order…" : "Place order";
    }

    function openCart() {
        if (!mobileQuery.matches) return;

        cartTriggerElement = document.activeElement;
        document.body.classList.add("cart-open");
        els.backdrop.classList.add("is-open");
        syncCartAccessibility();
        window.setTimeout(() => els.cartCloseBtn.focus(), 80);
    }

    function closeCart({ restoreFocus = true } = {}) {
        if (!document.body.classList.contains("cart-open")) return;

        document.body.classList.remove("cart-open");
        els.backdrop.classList.remove("is-open");
        syncCartAccessibility();

        if (restoreFocus && cartTriggerElement && typeof cartTriggerElement.focus === "function") {
            cartTriggerElement.focus();
        }
    }

    function syncCartAccessibility() {
        const isHiddenDrawer = mobileQuery.matches && !document.body.classList.contains("cart-open");

        if (isHiddenDrawer) {
            els.cartPanel.setAttribute("aria-hidden", "true");
            els.cartPanel.setAttribute("inert", "");
        } else {
            els.cartPanel.removeAttribute("aria-hidden");
            els.cartPanel.removeAttribute("inert");
        }
    }

    /* ------------------------------------------------------------------
       Place order
       ------------------------------------------------------------------ */

    async function placeOrder() {
        if (state.submitting || state.cart.length === 0) return;

        const { count } = cartTotals();
        state.submitting = true;
        renderCart();

        const payload = {
            customerName: els.customerName.value.trim(),
            notes: els.orderNotes.value.trim(),
            items: state.cart.map(({ item, quantity }) => ({
                menuItemId: item.id,
                quantity
            }))
        };

        try {
            const order = await api(ENDPOINTS.orders, {
                method: "POST",
                body: JSON.stringify(payload)
            });

            state.cart = [];
            els.customerName.value = "";
            els.orderNotes.value = "";
            closeCart({ restoreFocus: false });
            showSuccess(order, count);
        } catch (error) {
            toast(error.message || "We couldn't place your order. Please try again.", "error", 4200);
        } finally {
            state.submitting = false;
            renderCart();
        }
    }

    function showSuccess(order, itemCount) {
        const queueNumber = order.queueNumber ?? 1;
        const customerName = order.customerName && order.customerName !== "Guest"
            ? order.customerName
            : "friend";

        els.successQueue.textContent = `#${queueNumber}`;
        els.successOrdinal.textContent = `${ordinal(queueNumber)} customer`;
        els.successName.textContent = customerName;
        els.successItems.textContent = String(
            itemCount || order.items?.reduce((sum, line) => sum + line.quantity, 0) || 0
        );
        els.successTotal.textContent = money(order.totalAmount);

        lastFocusedElement = document.activeElement;
        els.successModal.classList.add("is-open");
        els.successModal.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");

        window.setTimeout(() => els.successDone.focus(), 60);
    }

    function closeSuccess() {
        if (!els.successModal.classList.contains("is-open")) return;

        els.successModal.classList.remove("is-open");
        els.successModal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");

        if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
            lastFocusedElement.focus();
        }
    }

    function trapModalFocus(event) {
        if (event.key !== "Tab" || !els.successModal.classList.contains("is-open")) return;

        const focusable = els.successModal.querySelectorAll(
            'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    /* ------------------------------------------------------------------
       QR code
       ------------------------------------------------------------------ */

    function initQr() {
        const canvas = els.qrImage.closest(".qr-canvas");

        els.qrImage.addEventListener("load", () => {
            canvas.classList.add("is-ready");
        });

        els.qrImage.addEventListener("error", () => {
            canvas.classList.add("is-error");
            els.qrSkeleton.innerHTML = "<span>QR unavailable</span>";
            els.qrNote.textContent = "Start the Spring Boot app, then refresh this page.";
            els.qrNote.classList.add("is-warning");
        });

        els.qrImage.src = ENDPOINTS.qr;
        els.copyUrlBtn.disabled = true;

        loadNetworkInfo();
    }

    async function loadNetworkInfo() {
        try {
            const info = await api(ENDPOINTS.network);
            const menuUrl = info.menuUrl || `${API_BASE}/`;

            els.qrUrl.textContent = menuUrl;
            els.qrUrl.title = menuUrl;
            els.copyUrlBtn.dataset.url = menuUrl;
            els.copyUrlBtn.disabled = false;

            if (info.isLocalhost) {
                els.qrNote.textContent = "Connect this Mac to Wi-Fi so nearby phones can scan the code.";
                els.qrNote.classList.add("is-warning");
            } else {
                els.qrNote.textContent = "Point your camera here to open the menu. Same Wi-Fi required.";
            }
        } catch {
            const fallbackUrl = `${API_BASE}/`;
            els.qrUrl.textContent = fallbackUrl;
            els.qrUrl.title = fallbackUrl;
            els.copyUrlBtn.dataset.url = fallbackUrl;
            els.copyUrlBtn.disabled = false;
            els.qrNote.textContent = "Start the Spring Boot app so nearby phones can scan the code.";
            els.qrNote.classList.add("is-warning");
        }
    }

    async function copyMenuLink() {
        const url = els.copyUrlBtn.dataset.url;
        if (!url) return;

        try {
            await navigator.clipboard.writeText(url);
            toast("Menu link copied — share it with a friend.", "success");
        } catch {
            const textarea = document.createElement("textarea");
            textarea.value = url;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand("copy");
                toast("Menu link copied.", "success");
            } catch {
                toast("Couldn't copy the link. You can select it manually.", "error");
            } finally {
                textarea.remove();
            }
        }
    }

    /* ------------------------------------------------------------------
       Events & init
       ------------------------------------------------------------------ */

    function bindEvents() {
        document.addEventListener("click", (event) => {
            const addButton = event.target.closest("[data-add]");
            if (addButton) {
                const itemId = Number(addButton.dataset.add);
                const item = state.menu.find((entry) => Number(entry.id) === itemId);
                if (item) {
                    addToCart(item);
                    flashAdded(addButton);
                }
                return;
            }

            const categoryChip = event.target.closest("[data-category]");
            if (categoryChip) {
                state.category = categoryChip.dataset.category || "All";
                renderCategoryFilters();
                renderMenu();
                return;
            }

            const cartButton = event.target.closest("[data-cart]");
            if (cartButton) {
                changeQuantity(
                    Number(cartButton.dataset.id),
                    cartButton.dataset.cart === "inc" ? 1 : -1
                );
                return;
            }

            if (event.target.closest("[data-retry-menu]")) {
                loadMenu();
            }
        });

        els.refreshMenuBtn.addEventListener("click", async () => {
            if (els.refreshMenuBtn.classList.contains("is-spinning")) return;

            els.refreshMenuBtn.classList.add("is-spinning");
            await loadMenu({ silent: true });
            els.refreshMenuBtn.classList.remove("is-spinning");
            toast("Menu refreshed.", "success", 1800);
        });

        els.placeOrderBtn.addEventListener("click", placeOrder);
        els.cartTrigger.addEventListener("click", openCart);
        els.mobileCartBtn.addEventListener("click", openCart);
        els.cartCloseBtn.addEventListener("click", () => closeCart());
        els.backdrop.addEventListener("click", () => closeCart());

        els.copyUrlBtn.addEventListener("click", copyMenuLink);

        els.successCloseBtn.addEventListener("click", closeSuccess);
        els.successDone.addEventListener("click", closeSuccess);
        els.successModal.addEventListener("click", (event) => {
            if (event.target === els.successModal) closeSuccess();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                if (els.successModal.classList.contains("is-open")) {
                    closeSuccess();
                } else if (document.body.classList.contains("cart-open")) {
                    closeCart();
                }
            }

            trapModalFocus(event);
        });

        window.addEventListener("scroll", () => {
            els.siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
        }, { passive: true });

        mobileQuery.addEventListener("change", () => {
            if (!mobileQuery.matches) {
                closeCart({ restoreFocus: false });
                els.backdrop.classList.remove("is-open");
            }
            syncCartAccessibility();
        });

        els.year.textContent = String(new Date().getFullYear());
    }

    function init() {
        bindEvents();
        setMenuLoading();
        renderCart();
        renderCategoryFilters();
        syncCartAccessibility();
        initQr();
        loadMenu();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
