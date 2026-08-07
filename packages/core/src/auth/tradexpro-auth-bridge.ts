/* eslint-disable no-console -- intentional temporary debug logging, see comments throughout */

// Receives silent SSO from the parent tradexpro.co.ke site when this app is
// embedded as its Manual Traders iframe. Speaks the same TRADEXPRO_AUTH /
// DTRADER_AUTH_READY / AUTH_LOGOUT protocol as dtrader-template's own
// auth-bridge.ts (ManualTraders.tsx on the parent side doesn't know or care
// which app is actually running in the iframe -- same domain, same
// protocol). If this app is ever loaded standalone (not embedded), nothing
// here fires and it behaves exactly as it already does today.

const PARENT_ORIGIN = 'https://tradexpro.co.ke';

// What this app itself actually reads on boot -- confirmed against
// packages/utils/src/getAccountsFromLocalStorage.ts and
// packages/utils/src/getActiveLoginIDFromLocalStorage.ts.
const ACCOUNTS_KEY = 'client.accounts';
const ACTIVE_LOGINID_KEY = 'active_loginid';

// ROOT CAUSE of the persistent "Start trading with us" login modal
// (traced 2026-08-07): this file used to decide whether to reload with
// ?token= by comparing activeLoginid against sessionStorage's previous
// value. sessionStorage survives a plain page reload, but client-store.js's
// boot sequence only ever performs a real authorize() via the
// oneTimeToken (?token=) branch; getStoredSessionToken() (the sole
// fallback) reads localStorage['session_token'] / a session_token
// cookie, which nothing this bridge writes ever touches. So once the
// storage comparison decided "loginid unchanged, no reload needed" for
// a document that merely matched an earlier, separate document
// instance's last-written value, that document had no authorization
// path left and silently booted logged-out permanently.
//
// A naive in-memory "have I reloaded yet this document instance" flag
// (tried first, reverted 2026-08-07 after it caused an infinite reload
// loop) doesn't work either: the parent resends TRADEXPRO_AUTH every
// time this iframe sends DTRADER_AUTH_READY, and DTRADER_AUTH_READY is
// sent again on every fresh load -- including the ones this file's own
// reload just caused -- so an in-memory flag that starts false on every
// load reloads again immediately, forever.
//
// The actual fix needs both pieces: hadTokenAtLoad captures, at module
// eval time (index.tsx calls initTradexproAuthBridge() synchronously,
// before client-store's async init() ever runs removeTokenFromUrl()),
// whether THIS document was itself requested with a ?token= -- i.e.
// whether it's already the result of one of our redirects. Combined
// with the original loginid comparison, a message is only treated as
// needing a reload if the account actually changed, OR this document
// never had a token to begin with (a plain refresh/first visit, which
// is exactly the original bug's case). Once reloadedThisInstance is
// set, no further message in this same document instance reloads
// again, breaking the loop; a document that already booted with a
// token never has a reason to reload for the same account, so the loop
// never starts in the first place.
const hadTokenAtLoad = new URLSearchParams(window.location.search).has('token');
let reloadedThisInstance = false;

interface IncomingAccount {
    account: string;
    token: string;
    currency?: string;
    account_type?: string;
}

interface TradexproAuthMessage {
    type: 'TRADEXPRO_AUTH';
    token: string;
    loginid?: string;
    accounts?: IncomingAccount[];
}

// Safe wrappers - a single storage operation throwing (SecurityError from
// storage restrictions, private browsing, quota exceeded, etc - all more
// likely in this embedded-iframe context on mobile than on desktop) must
// not abort the rest of applyAuth(). Without this, one blocked write could
// silently prevent the reload that actually authenticates the page,
// leaving the app boot-looping in its initial unauthenticated state
// forever - every data-dependent hook downstream just hangs waiting for
// authorization that never arrives.
function safeGetItem(storage: Storage, key: string): string | null {
    try {
        return storage.getItem(key);
    } catch (err) {
        console.warn('[TradexproAuthBridge] storage read failed', key, err);
        return null;
    }
}

function safeSetItem(storage: Storage, key: string, value: string): boolean {
    try {
        storage.setItem(key, value);
        return true;
    } catch (err) {
        console.warn('[TradexproAuthBridge] storage write failed', key, err);
        return false;
    }
}

function safeRemoveItem(storage: Storage, key: string): void {
    try {
        storage.removeItem(key);
    } catch (err) {
        console.warn('[TradexproAuthBridge] storage remove failed', key, err);
    }
}

function applyAuth(data: TradexproAuthMessage): void {
    if (!data.token) {
        console.warn('[TradexproAuthBridge] TRADEXPRO_AUTH received with no token, ignoring', data);
        return;
    }

    // Capture this BEFORE any writes -- combined with hadTokenAtLoad above,
    // this is what decides whether we actually need to reload. See the
    // module-level comment for why both checks are needed together.
    const previousLoginid = safeGetItem(sessionStorage, ACTIVE_LOGINID_KEY);

    const accountsList = data.accounts?.length
        ? data.accounts
        : data.loginid
          ? [{ account: data.loginid, token: data.token }]
          : [];

    console.log('[TradexproAuthBridge] applyAuth called', {
        has_loginid: !!data.loginid,
        accounts_count: accountsList.length,
        previous_loginid: previousLoginid,
    });

    if (accountsList.length) {
        const accountsMap: Record<string, unknown> = {};
        accountsList.forEach(acc => {
            accountsMap[acc.account] = {
                token: acc.token || data.token,
                accepted_bch: 1,
                landing_company_shortcode: 'svg',
                residence: '',
                session_start: Math.floor(Date.now() / 1000),
            };
        });
        safeSetItem(localStorage, ACCOUNTS_KEY, JSON.stringify(accountsMap));
    } else {
        console.warn(
            '[TradexproAuthBridge] no accounts to write -- neither data.accounts nor data.loginid was present',
            data
        );
    }

    const activeLoginid = data.loginid || accountsList[0]?.account;
    if (activeLoginid) {
        // getActiveLoginIDFromLocalStorage checks sessionStorage first,
        // then falls back to localStorage -- set both so a stale entry
        // from an earlier boot in this tab can't shadow this value.
        safeSetItem(sessionStorage, ACTIVE_LOGINID_KEY, activeLoginid);
        safeSetItem(localStorage, ACTIVE_LOGINID_KEY, activeLoginid);
    }

    if (activeLoginid && !reloadedThisInstance && (activeLoginid !== previousLoginid || !hadTokenAtLoad)) {
        // A bare reload only ever re-read client.accounts/active_loginid,
        // which sets display info (loginid, current_account) but never
        // triggers a live authorize call -- confirmed in client-store.js:
        // authorize_response (and subscribeBalance(), gated entirely behind
        // it) is only ever populated via the oneTimeToken/session-token
        // path (a ?token= URL param, read once then stripped via
        // removeTokenFromUrl -- the classic one-time SSO handoff pattern).
        // That's why balance stayed permanently unpopulated no matter how
        // correct the account/token data in storage was. Appending our
        // token to the URL instead routes through that same real flow.
        //
        // See the module-level comment above for why this condition needs
        // both hadTokenAtLoad and the loginid comparison, and why either
        // one alone reintroduces a bug (the modal, or an infinite reload
        // loop) that was already hit and fixed once today.
        reloadedThisInstance = true;
        const url = new URL(window.location.href);
        url.searchParams.set('token', data.token);
        console.log(
            '[TradexproAuthBridge] reloading with token to trigger live authorize',
            previousLoginid,
            '->',
            activeLoginid,
            'hadTokenAtLoad:',
            hadTokenAtLoad
        );
        window.location.href = url.toString();
    } else {
        console.log('[TradexproAuthBridge] no reload needed', {
            activeLoginid,
            previousLoginid,
            hadTokenAtLoad,
            reloadedThisInstance,
        });
    }
}

function clearAuth(): void {
    safeRemoveItem(localStorage, ACCOUNTS_KEY);
    safeRemoveItem(sessionStorage, ACTIVE_LOGINID_KEY);
    safeRemoveItem(localStorage, ACTIVE_LOGINID_KEY);
    window.location.reload();
}

export function initTradexproAuthBridge(): void {
    // Not embedded -- e.g. loaded directly, or in an iframe on some other
    // site. Nothing to do.
    if (window.self === window.top) {
        console.log('[TradexproAuthBridge] not embedded (window.self === window.top), skipping');
        return;
    }

    console.log('[TradexproAuthBridge] initializing, expecting parent origin', PARENT_ORIGIN);

    window.addEventListener('message', (event: MessageEvent) => {
        if (event.origin !== PARENT_ORIGIN) {
            // Logged at this level (not just dropped silently) because a
            // subtly wrong PARENT_ORIGIN comparison is exactly the kind of
            // bug that would otherwise look identical to "message never
            // arrived" from the outside.
            console.log('[TradexproAuthBridge] ignoring message from unexpected origin', event.origin, event.data);
            return;
        }

        console.log('[TradexproAuthBridge] received message from parent', event.data?.type, event.data);

        if (event.data?.type === 'TRADEXPRO_AUTH') {
            applyAuth(event.data as TradexproAuthMessage);
        } else if (event.data?.type === 'AUTH_LOGOUT') {
            clearAuth();
        }
    });

    // Parent resends auth whenever it sees this, and also proactively
    // whenever its own login state settles -- either path gets us
    // authenticated without the user doing anything in this iframe.
    console.log('[TradexproAuthBridge] sending DTRADER_AUTH_READY to parent');
    window.parent.postMessage({ type: 'DTRADER_AUTH_READY' }, PARENT_ORIGIN);
}
