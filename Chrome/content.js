// Silence Roblox console noise
const originalError = console.error;
console.error = (...args) => {
    if (args.join(' ').match(/metrics|Sentry|Account|DialogContent|aria-describedby/)) return;
    originalError.apply(console, args);
};

const runtime = (typeof browser !== 'undefined') ? browser : chrome;

function safeInjectSVG(parent, svgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = doc.documentElement;
    parent.replaceChildren(svgElement);
}

async function handleJoin() {
    const match = window.location.href.match(/games\/(\d+)/);
    if (!match) return;
    const placeId = match[1];

    // content.js inside handleJoin()
    const settings = await runtime.storage.local.get({ 
        prefSize: 'random', 
        excludeFull: true 
    });

    console.group(`%c[Roblox Suite] Finding Server...`, "color: #00A2FF; font-weight: bold;");

    try {
        const res = await fetch(`https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&sortOrder=Asc&_=${Date.now()}`);
        const data = await res.json();

        if (!data?.data?.length) {
            console.error("❌ API returned no servers. Roblox may be rate-limiting you.");
            console.groupEnd();
            return;
        }

        // Use playerTokens.length as the real player count —
        // the 'playing' field is a cached value that can lag by several minutes.
        const count = s => s?.playerTokens?.length ?? s?.playing ?? 0;

        let servers = data.data.filter(s => s && (!settings.excludeFull || count(s) < s.maxPlayers));
        if (servers.length === 0) {
            console.error("❌ No servers available.");
            console.groupEnd();
            return;
        }

        servers.sort((a, b) => count(a) - count(b));

        const logRange = (label, pool) => {
            if (pool.length === 0) { console.log(`[RSS] ${label} | no candidates`); return; }
            console.log(`[RSS] ${label} | ${pool.length} candidates | range: ${count(pool[0])}–${count(pool[pool.length-1])} players`);
        };

        let target;
        if (settings.prefSize === 'small') {
            const pool = servers.slice(0, Math.min(10, servers.length));
            logRange('small', pool);
            target = pool[Math.floor(Math.random() * pool.length)];
        } else {
            logRange('random', servers);
            target = servers[Math.floor(Math.random() * servers.length)];
        }

        console.table(servers.slice(0, 5).map(s => ({
            ID: s.id.substring(0, 6) + "...",
            Players: `${count(s)}/${s.maxPlayers}`,
            Ping: s.ping + "ms"
        })));

        if (target) {
            console.log(`%c🚀 LAUNCHING: ${count(target)}/${target.maxPlayers} players | Job ID: ${target.id}`, "color: #00FF77; font-weight: bold;");
            console.groupEnd();

            // Persist last session for this game so the rejoin bar can show it
            runtime.storage.local.set({ [`lastJobId_${placeId}`]: target.id });
            updateLastSessionBar(placeId, target.id);

            const launcher = window.wrappedJSObject?.Roblox?.GameLauncher;
            if (launcher?.joinGameInstance) {
                launcher.joinGameInstance(parseInt(placeId), target.id);
            } else {
                window.location.href = `roblox://experiences/start?placeId=${placeId}&gameInstanceId=${target.id}`;
            }
        } else {
            console.error("❌ No servers met the criteria.");
            console.groupEnd();
        }
    } catch (err) {
        console.error("Extension Error:", err);
        console.groupEnd();
    }
}

// ── LAST SESSION BAR ─────────────────────────────────────────────────────────

let _lastSessionInjecting = false;

function updateLastSessionBar(_placeId, jobId) {
    const bar = document.getElementById('rss-last-session');
    if (!bar) return;
    const link = bar.querySelector('a');
    if (!link) return;
    link.dataset.jobId = jobId;
    link.textContent = jobId.split('-')[0];
    link.title = jobId;
}

async function injectLastSession() {
    // Sync guard prevents duplicate bars from concurrent async calls
    if (document.getElementById('rss-last-session') || _lastSessionInjecting) return;
    _lastSessionInjecting = true;

    try {
        const match = window.location.href.match(/games\/(\d+)/);
        if (!match) return;
        const placeId = match[1];

        const key = `lastJobId_${placeId}`;
        const res = await runtime.storage.local.get({ [key]: null });
        const jobId = res[key];
        if (!jobId) return;

        // Re-check after async gap
        if (document.getElementById('rss-last-session')) return;

        const playBtn = document.querySelector('#PlayButton') ||
                        document.querySelector('.btn-common-play-main') ||
                        document.querySelector('[data-testid="play-button"]');
        if (!playBtn) return;

        const bar = document.createElement('div');
        bar.id = 'rss-last-session';

        const label = document.createElement('span');
        label.className = 'text-label';
        label.textContent = 'Latest Session: ';

        const link = document.createElement('a');
        link.className = 'text-name text-overflow';
        link.href = '#';
        link.textContent = jobId.split('-')[0];
        link.title = jobId;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = `roblox://experiences/start?placeId=${placeId}&gameInstanceId=${jobId}`;
        });

        bar.appendChild(label);
        bar.appendChild(link);

        const wrapper = document.getElementById('rss-btn-wrapper');
        const anchor = wrapper ?? playBtn;
        anchor.parentNode.insertBefore(bar, anchor);
    } finally {
        _lastSessionInjecting = false;
    }
}

// ── BUTTON INJECTION ─────────────────────────────────────────────────────────

const SMART_JOIN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="10" cy="10" r="7"/>
    <line x1="15" y1="15" x2="21" y2="21"/>
    <polygon fill="currentColor" stroke="none" points="8,7 8,13 14,10"/>
</svg>`;

function injectSmartJoinButton() {
    if (document.getElementById('rss-smart-join')) return;

    const playBtn = document.querySelector('#PlayButton') ||
                    document.querySelector('.btn-common-play-main') ||
                    document.querySelector('[data-testid="play-button"]');

    if (!playBtn) return;

    const btn = document.createElement('button');
    btn.id = 'rss-smart-join';
    btn.title = 'Smart Join — use preferred server settings';
    
    // USE THE HELPER
    safeInjectSVG(btn, SMART_JOIN_ICON);

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleJoin();
    }, true);

    const wrapper = document.createElement('div');
    wrapper.id = 'rss-btn-wrapper';
    playBtn.parentNode.insertBefore(wrapper, playBtn);
    wrapper.appendChild(playBtn);
    wrapper.appendChild(btn);

    requestAnimationFrame(() => {
        const h = playBtn.getBoundingClientRect().height;
        if (h > 0) btn.style.setProperty('height', `${h}px`, 'important');
    });
}

// ── PRIVATE SERVERS COLLAPSE ─────────────────────────────────────────────────

const CHEVRON_UP   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor"><path d="M297.4 201.4C309.9 188.9 330.2 188.9 342.7 201.4L502.7 361.4C515.2 373.9 515.2 394.2 502.7 406.7C490.2 419.2 469.9 419.2 457.4 406.7L320 269.3L182.6 406.6C170.1 419.1 149.8 419.1 137.3 406.6C124.8 394.1 124.8 373.8 137.3 361.3L297.3 201.3z"/></svg>`;
const CHEVRON_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor"><path d="M297.4 438.6C309.9 451.1 330.2 451.1 342.7 438.6L502.7 278.6C515.2 266.1 515.2 245.8 502.7 233.3C490.2 220.8 469.9 220.8 457.4 233.3L320 370.7L182.6 233.4C170.1 220.9 149.8 220.9 137.3 233.4C124.8 245.9 124.8 266.2 137.3 278.7L297.3 438.7z"/></svg>`;

function injectPrivateServerCollapse() {
    if (document.getElementById('rss-private-collapse')) return;

    // Find the leaf element whose text is exactly "Private Servers"
    const heading = [...document.querySelectorAll('h2, h3, h4, p, span, div, li')]
        .find(el => el.children.length === 0 && el.textContent.trim() === 'Private Servers');

    if (!heading) return;

    // The row containing the heading, and the section wrapping everything
    const headerRow = heading.parentElement;
    const section   = headerRow?.parentElement;
    if (!section) return;

    let collapsed = false;

    const btn = document.createElement('button');
    btn.id = 'rss-private-collapse';
    btn.title = 'Collapse Private Servers';
    safeInjectSVG(btn, CHEVRON_UP);

    function applyCollapsed(state) {
        collapsed = state;
        [...section.children].forEach((child, i, arr) => {
            if (i > arr.indexOf(headerRow)) {
                child.style.setProperty('display', collapsed ? 'none' : '', 'important');
            }
        });
        
        // USE THE HELPER
        safeInjectSVG(btn, collapsed ? CHEVRON_DOWN : CHEVRON_UP);
        
        btn.title = collapsed ? 'Expand Private Servers' : 'Collapse Private Servers';
    }

    function toggle() {
        applyCollapsed(!collapsed);
        runtime.storage.local.set({ privateServersCollapsed: collapsed });
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle();
    });

    // Prepend the button inside the heading element so it always sits to the
    // left of the text, regardless of the parent container's layout.
    heading.style.setProperty('display', 'inline-flex', 'important');
    heading.style.setProperty('align-items', 'center', 'important');
    heading.style.setProperty('gap', '6px', 'important');
    heading.style.setProperty('cursor', 'pointer', 'important');
    heading.style.setProperty('user-select', 'none', 'important');
    heading.prepend(btn);

    heading.addEventListener('click', toggle);
    heading.addEventListener('mouseenter', () => btn.style.setProperty('opacity', '1', 'important'));
    heading.addEventListener('mouseleave', () => btn.style.removeProperty('opacity'));

    // Size as a square matching the heading's font size
    requestAnimationFrame(() => {
        const size = Math.round(parseFloat(getComputedStyle(heading).fontSize));
        if (size > 0) {
            btn.style.setProperty('width', `${size}px`, 'important');
            btn.style.setProperty('height', `${size}px`, 'important');
        }
    });

    // Restore persisted state
    runtime.storage.local.get({ privateServersCollapsed: false }).then(res => {
        if (res.privateServersCollapsed) applyCollapsed(true);
    });
}

// ── PRIVATE SERVER QUICK CONFIG ──────────────────────────────────────────────

let _csrfToken = null;

async function vipApiPerms(serverId, body) {
    return vipFetch(`https://games.roblox.com/v1/vip-servers/${serverId}/permissions`, 'PATCH', body);
}

async function vipFetch(url, method, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
    const opts = { method, credentials: 'include', headers };
    if (body) opts.body = JSON.stringify(body);

    let res = await fetch(url, opts);
    console.log('[RSS] fetch', method, 'status:', res.status);

    // Only retry on 403 to refresh a stale token — never retry 429
    if (res.status === 403) {
        const token = res.headers.get('x-csrf-token');
        if (token) { _csrfToken = token; headers['X-CSRF-Token'] = token; }
        res = await fetch(url, opts);
        console.log('[RSS] retry status:', res.status);
    }

    return res.json();
}

async function vipApi(serverId, method = 'GET', body = null) {
    return vipFetch(`https://games.roblox.com/v1/vip-servers/${serverId}`, method, body);
}


function injectPrivateServerQuickConfig() {
    document.querySelectorAll('.btn-generic-more-sm').forEach(dotsBtn => {
        if (dotsBtn.dataset.rssQc) return;
        dotsBtn.dataset.rssQc = '1';

        dotsBtn.addEventListener('click', () => {

            const watcher = new MutationObserver(() => {
                // Roblox renders the dropdown somewhere in the body — search globally
                const configureLink = document.querySelector('a[href*="/private-server/configure"]');
                if (!configureLink) return;

                const ul = configureLink.closest('ul');
                if (!ul) return;
                if (ul.dataset.rssInjected) return;
                ul.dataset.rssInjected = '1';

                watcher.disconnect();

                const positionDropdown = () => {
                    const popover = ul.closest('#game-instance-dropdown-menu, .popover');
                    if (!popover) return;

                    const btnRect = dotsBtn.getBoundingClientRect();

                    // Move the whole popover container — arrow stays inside and aligned
                    popover.style.setProperty('position', 'fixed', 'important');
                    popover.style.setProperty('transform', 'none', 'important');
                    popover.style.setProperty('width', 'max-content', 'important');
                    popover.style.setProperty('left', '-9999px', 'important');
                    popover.style.setProperty('top', `${btnRect.bottom}px`, 'important');

                    // Undo any ul overrides so it lays out naturally inside the popover
                    ul.style.removeProperty('position');
                    ul.style.removeProperty('top');
                    ul.style.removeProperty('left');
                    ul.style.removeProperty('transform');
                    ul.style.removeProperty('width');

                    setTimeout(() => {
                        const popoverWidth = popover.getBoundingClientRect().width;
                        const btnCenterX = btnRect.left + btnRect.width / 2;
                        const left = Math.max(8, Math.min(btnCenterX - popoverWidth / 2, window.innerWidth - popoverWidth - 8));
                        popover.style.setProperty('left', `${left}px`, 'important');

                        // Center arrow on the button
                        const arrow = popover.querySelector('.arrow');
                        if (arrow) {
                            const arrowLeft = btnCenterX - left;
                            arrow.style.setProperty('left', `${arrowLeft}px`, 'important');
                        }
                    }, 30);
                };

                const applyPosition = () => {
                    const popover = ul.closest('#game-instance-dropdown-menu, .popover');
                    if (!popover || !document.body.contains(popover)) {
                        window.removeEventListener('scroll', applyPosition, { capture: true });
                        return;
                    }
                    const btnRect = dotsBtn.getBoundingClientRect();
                    const popoverWidth = popover.getBoundingClientRect().width;
                    const btnCenterX = btnRect.left + btnRect.width / 2;
                    const left = Math.max(8, Math.min(btnCenterX - popoverWidth / 2, window.innerWidth - popoverWidth - 8));
                    popover.style.setProperty('top', `${btnRect.bottom}px`, 'important');
                    popover.style.setProperty('left', `${left}px`, 'important');
                };

                window.addEventListener('scroll', applyPosition, { capture: true, passive: true });

                const href = configureLink.getAttribute('href');
                const match = href.match(/[?&](?:private)?[Ss]erver[Ii]d=([^&]+)/i) || href.match(/[?&]id=([^&]+)/);
                if (!match) return;
                const serverId = match[1];

                // Use mousedown instead of click — fires before Roblox's dropdown-close handler
                function makeItem(label, onMousedown) {
                    const li = document.createElement('li');
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'rbx-private-game-server-menu-btn';
                    btn.textContent = label;
                    btn.addEventListener('mousedown', (e) => {
                        if (btn.disabled) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onMousedown(btn);
                    });
                    li.appendChild(btn);
                    return li;
                }

                vipApi(serverId).then(data => {
                    let allowJoining = data.active !== false;
                    let friendsAllowed = data.permissions?.friendsAllowed !== false;
                    const joinCode = data.joinCode || '';
                    const shareLink = joinCode ? `https://www.roblox.com/share?code=${joinCode}&type=Server` : '';

                    const connBtn = { el: null };

                    function setConnGreyed(greyed) {
                        if (!connBtn.el) return;
                        connBtn.el.disabled = greyed;
                        connBtn.el.style.setProperty('opacity', greyed ? '0.4' : '1', 'important');
                        connBtn.el.style.setProperty('cursor', greyed ? 'not-allowed' : 'pointer', 'important');
                        connBtn.el.style.setProperty('pointer-events', greyed ? 'none' : '', 'important');
                    }

                    const allowItem = makeItem(`Allow Joining: ${allowJoining ? 'On' : 'Off'}`, async (btn) => {
                        allowJoining = !allowJoining;
                        btn.textContent = `Allow Joining: ${allowJoining ? 'On' : 'Off'}`;
                        btn.disabled = true;
                        await vipApi(serverId, 'PATCH', { active: allowJoining });
                        btn.disabled = false;
                        setConnGreyed(!allowJoining);
                    });

                    const connItem = makeItem(`Connections Allowed: ${friendsAllowed ? 'On' : 'Off'}`, async (btn) => {
                        friendsAllowed = !friendsAllowed;
                        btn.textContent = `Connections Allowed: ${friendsAllowed ? 'On' : 'Off'}`;
                        btn.disabled = true;
                        const payload = {
                            clanAllowed: data.permissions?.clanAllowed ?? false,
                            enemyClanId: data.permissions?.enemyClanId ?? null,
                            friendsAllowed,
                            users: data.permissions?.users ?? []
                        };
                        await vipApiPerms(serverId, payload);
                        btn.disabled = !allowJoining;
                    });

                    connBtn.el = connItem.querySelector('button');
                    setConnGreyed(!allowJoining);

                    const copyItem = makeItem('Copy Link', (btn) => {
                        if (shareLink) {
                            navigator.clipboard.writeText(shareLink);
                            btn.textContent = 'Copied!';
                            setTimeout(() => btn.textContent = 'Copy Link', 1500);
                        } else {
                            btn.textContent = 'No link available';
                        }
                    });

                    ul.appendChild(allowItem);
                    ul.appendChild(connItem);
                    ul.appendChild(copyItem);

                    positionDropdown();
                }).catch(e => console.log('[RSS] vipApi error:', e));
            });

            watcher.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { watcher.disconnect(); console.log('[RSS] watcher timed out'); }, 2000);
        });
    });
}

// Roblox renders via React — watch for the play button and private server header
const observer = new MutationObserver(() => {
    injectSmartJoinButton();
    injectLastSession();
    injectPrivateServerCollapse();
    injectPrivateServerQuickConfig();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
injectSmartJoinButton();
injectLastSession();
injectPrivateServerCollapse();
injectPrivateServerQuickConfig();
