const DerivAPIBasic = require('@deriv/deriv-api/dist/DerivAPIBasic');
const getSocketURL = require('@deriv/shared').getSocketURL;
const cloneObject = require('@deriv/shared').cloneObject;
const State = require('@deriv/shared').State;
const getBrandName = require('@deriv/shared').getBrandName;
const SocketCache = require('./socket_cache');
const APIMiddleware = require('./api_middleware');

/*
 * An abstraction layer over native javascript WebSocket,
 * which provides additional functionality like
 * reopen the closed connection and process the buffered requests
 */
const BinarySocketBase = (() => {
    let deriv_api, binary_socket, client_store;

    let config = {};
    let is_disconnect_called = false;
    let is_connected_before = false;
    let is_switching_socket = false;

    const availability = {
        is_up: true,
        is_updating: false,
        is_down: false,
    };

    const getSocketUrl = (is_mock_server = false) => {
        if (is_mock_server) {
            return 'ws://127.0.0.1:42069';
        }
        // TODO remove hardcoded app_id in future
        return `wss://${getSocketURL()}/websockets/v3?app_id=16929&brand=${getBrandName().toLowerCase()}`;
    };

    const isReady = () => hasReadyState(1);

    const isClose = () => !binary_socket || hasReadyState(2, 3);

    const blockRequest = value => deriv_api?.blockRequest(value);

    const close = () => {
        // ROOT CAUSE (confirmed 2026-08-09, with a second-opinion assist from
        // three independent AI reviews that all converged on this exact gap):
        // this call was unconditional -- binary_socket.close() regardless of
        // readyState. The is_connecting guard added earlier only prevents
        // overlapping *creates*; it does nothing to protect a socket that's
        // still CONNECTING from being closed out from under itself. If the
        // app's original boot-time classic connection (opened for public tick
        // data before login) hasn't finished its handshake yet by the time
        // connectToOtpUrl() runs -- entirely plausible, since the OTP REST
        // fetch and that handshake are racing from page load -- calling
        // .close() on it mid-handshake is exactly what produces "WebSocket is
        // closed before the connection is established" for that exact URL,
        // every time. It was never a second/duplicate connection attempt;
        // it was this app's own code aborting its own first one too early.
        //
        // Fix: if the socket is still CONNECTING, don't abort it -- let it
        // finish opening (or fail) on its own, then close it immediately
        // once it does, via a one-time listener. This releases the same
        // resource without ever calling close() on a CONNECTING socket.
        if (binary_socket.readyState === WebSocket.CONNECTING) {
            binary_socket.addEventListener('open', () => binary_socket.close(), { once: true });
            return;
        }
        binary_socket.close();
    };

    const closeAndOpenNewConnection = (session_id = '') => {
        close();
        is_switching_socket = true;
        // Force-clear the guard: this is a deliberate, intentional new
        // connection request, not the kind of accidental race the guard
        // exists to prevent -- it must never block itself.
        is_connecting = false;
        openNewConnection(session_id);
    };

    // ROOT CAUSE fix (confirmed 2026-08-08 against Deriv's actual API docs):
    // this app's WebSocket has always connected to the classic
    // /websockets/v3 endpoint and tried to authenticate an OAuth-format
    // token over it via get_session_token -- a method that doesn't exist in
    // Deriv's real API -- then, after that was fixed, by passing the same
    // OAuth token directly to the classic authorize call, which also
    // rejects it (the token contains a '.', which the classic authorize
    // param's validation regex ^[\w\-]{1,128}$ doesn't allow). Deriv's
    // actual documented flow for this token format is entirely different:
    // fetch a one-time-use, already-authenticated WebSocket URL via a REST
    // call, then connect directly to THAT url -- no message-based
    // authorize step at all ("No additional authentication headers are
    // needed -- the OTP in the URL handles authentication"). This is
    // exactly what TradeXpro's own main app already does successfully for
    // the same account/token type.
    const connectToOtpUrl = otpUrl => {
        otp_override_url = otpUrl;
        close();
        is_switching_socket = true;
        // Same reasoning as closeAndOpenNewConnection above: this is the
        // deliberate OTP-authenticated connection itself -- it must always
        // be allowed to proceed, never blocked by its own guard.
        is_connecting = false;
        openNewConnection();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timed out connecting to OTP-authenticated URL')), 15000);
            deriv_api.onOpen().subscribe(() => {
                clearTimeout(timeout);
                resolve();
            });
        });
    };

    const hasReadyState = (...states) => binary_socket && states.some(s => binary_socket.readyState === s);

    const init = ({ options, client }) => {
        if (typeof options === 'object' && config !== options) {
            config = options;
        }
        client_store = client;
    };

    const getMockServerConfig = () => {
        const mock_server_config = localStorage.getItem('mock_server_data');
        return mock_server_config
            ? JSON.parse(mock_server_config)
            : {
                  session_id: '',
                  is_mockserver_enabled: false,
              };
    };

    // Set by connectToOtpUrl() when authenticating via Deriv's real Options
    // API OTP flow (see authenticateV2 in client-store.js for why). When
    // set, openNewConnection() connects here instead of the classic
    // /websockets/v3 endpoint, and skips the classic authorize-on-open
    // logic below, since the OTP in this URL already authenticates the
    // connection per Deriv's own documentation ("No additional
    // authentication headers are needed").
    let otp_override_url = null;

    // ROOT CAUSE of "WebSocket is closed before the connection is
    // established" reintroducing the login modal after a successful OTP
    // connect (traced 2026-08-09): network_monitor_base.js calls
    // BinarySocket.openNewConnection() directly -- bypassing this file's
    // own is_switching_socket flag entirely -- on the browser's 'online'
    // event and on a 500ms-delayed reconnect check. Neither knows or
    // cares whether an OTP-authenticated connection is already being
    // established. If either fires while connectToOtpUrl()'s own
    // close()+openNewConnection() sequence is mid-flight (a real
    // possibility on mobile, where brief connectivity blips are common,
    // and coincidentally close in timing to the ~500ms OTP REST fetch),
    // two overlapping `new WebSocket()` calls race each other and one
    // gets aborted mid-handshake. This guard makes openNewConnection()
    // a no-op while a previous call's connection attempt hasn't finished
    // opening yet, regardless of which caller triggered either one --
    // a connection attempt already in flight should never be interrupted
    // by another one starting, whatever the reason.
    let is_connecting = false;

    const openNewConnection = () => {
        if (is_connecting) return;

        const mock_server_config = getMockServerConfig();
        const session_id = mock_server_config?.session_id || '';

        if (!is_switching_socket) config.wsEvent('init');

        if (isClose()) {
            is_disconnect_called = false;
            is_connecting = true;
            binary_socket = new WebSocket(otp_override_url || getSocketUrl(session_id));

            deriv_api = new DerivAPIBasic({
                connection: binary_socket,
                storage: SocketCache,
                middleware: new APIMiddleware(config, session_id),
            });
        }

        deriv_api.onOpen().subscribe(() => {
            is_connecting = false;
            config.wsEvent('open');

            if (!otp_override_url && client_store.is_logged_in) {
                const authorize_token = client_store.getToken();
                deriv_api.authorize(authorize_token);
            }

            if (typeof config.onOpen === 'function') {
                config.onOpen(isReady());
            }

            if (typeof config.onReconnect === 'function' && is_connected_before) {
                config.onReconnect();
            }

            if (!is_connected_before) {
                is_connected_before = true;
            }
        });

        deriv_api.onMessage().subscribe(({ data: response }) => {
            const msg_type = response.msg_type;
            State.set(['response', msg_type], cloneObject(response));

            config.wsEvent('message');

            if (typeof config.onMessage === 'function') {
                config.onMessage(response);
            }
        });

        deriv_api.onClose().subscribe(() => {
            // A connection attempt that closes before opening (aborted,
            // rejected, or a genuine failure) must clear this too --
            // otherwise a single failed attempt would permanently block
            // every future connection, including legitimate retries.
            is_connecting = false;

            if (!is_switching_socket) {
                config.wsEvent('close');
            } else {
                is_switching_socket = false;
            }

            if (typeof config.onDisconnect === 'function' && !is_disconnect_called) {
                config.onDisconnect();
                is_disconnect_called = true;
            }
        });
    };

    const isSiteUp = status => /^up$/i.test(status);

    const isSiteUpdating = status => /^updating$/i.test(status);

    const isSiteDown = status => /^down$/i.test(status);

    // if status is up or updating, consider site available
    // if status is down, consider site unavailable
    const setAvailability = status => {
        availability.is_up = isSiteUp(status);
        availability.is_updating = isSiteUpdating(status);
        availability.is_down = isSiteDown(status);
    };

    const excludeAuthorize = type => !(type === 'authorize' && !client_store.is_logged_in);

    const wait = (...responses) => deriv_api?.expectResponse(...responses.filter(excludeAuthorize));

    const subscribe = (request, cb) => deriv_api.subscribe(request).subscribe(cb, cb); // Delegate error handling to the callback

    const subscribeBalance = cb => subscribe({ balance: 1 }, cb);

    const subscribeProposal = (req, cb) => subscribe({ proposal: 1, ...req }, cb);

    const subscribeProposalOpenContract = (contract_id = null, cb) =>
        subscribe({ proposal_open_contract: 1, ...(contract_id && { contract_id }) }, cb);

    const subscribeTicks = (symbol, cb) => subscribe({ ticks: symbol }, cb);

    const subscribeTicksHistory = (request_object, cb) => subscribe(request_object, cb);

    const subscribeTransaction = cb => subscribe({ transaction: 1 }, cb);

    const getTicksHistory = request_object => deriv_api.send(request_object);

    const buyAndSubscribe = request => {
        return new Promise(resolve => {
            let called = false;
            const subscriber = subscribe(request, response => {
                if (!called) {
                    called = true;
                    subscriber.unsubscribe();
                    resolve(response);
                }
            });
        });
    };

    const buy = ({ proposal_id, price }) => deriv_api.send({ buy: proposal_id, price });

    const sell = (contract_id, bid_price) => deriv_api.send({ sell: contract_id, price: bid_price });

    // Cashier functionality has been removed

    const newAccountVirtual = (verification_code, client_password, residence, device_data) =>
        deriv_api.send({
            new_account_virtual: 1,
            verification_code,
            client_password,
            residence,
            ...device_data,
        });

    const setAccountCurrency = (currency, passthrough) =>
        deriv_api.send({
            set_account_currency: currency,
            ...(passthrough && { passthrough }),
        });

    const newAccountReal = values =>
        deriv_api.send({
            new_account_real: 1,
            ...values,
        });

    const newAccountRealMaltaInvest = values => deriv_api.send({ new_account_maltainvest: 1, ...values });

    const mt5NewAccount = values =>
        deriv_api.send({
            mt5_new_account: 1,
            ...values,
        });

    const getFinancialAssessment = () =>
        deriv_api.send({
            get_financial_assessment: 1,
        });

    const setFinancialAndTradingAssessment = payload => deriv_api.send({ set_financial_assessment: 1, ...payload });

    const profitTable = (limit, offset, date_boundaries) =>
        deriv_api.send({ profit_table: 1, description: 1, limit, offset, ...date_boundaries });

    const statement = (limit, offset, other_properties) =>
        deriv_api.send({ statement: 1, description: 1, limit, offset, ...other_properties });

    const tradingPlatformPasswordChange = payload =>
        deriv_api.send({
            trading_platform_password_change: 1,
            ...payload,
        });

    const tradingPlatformInvestorPasswordChange = payload =>
        deriv_api.send({
            trading_platform_investor_password_change: 1,
            ...payload,
        });

    const tradingPlatformInvestorPasswordReset = payload =>
        deriv_api.send({
            trading_platform_investor_password_reset: 1,
            ...payload,
        });

    const tradingPlatformPasswordReset = payload =>
        deriv_api.send({
            trading_platform_password_reset: 1,
            ...payload,
        });

    const tradingPlatformAvailableAccounts = platform =>
        deriv_api.send({
            trading_platform_available_accounts: 1,
            platform,
        });

    const paymentAgentList = (country, currency) =>
        deriv_api.send({ paymentagent_list: country, ...(currency && { currency }) });

    const allPaymentAgentList = country => deriv_api.send({ paymentagent_list: country });

    const paymentAgentDetails = (passthrough, req_id) =>
        deriv_api.send({ paymentagent_details: 1, passthrough, req_id });

    const paymentAgentWithdraw = ({ amount, currency, dry_run = 0, loginid, verification_code }) =>
        deriv_api.send({
            amount,
            currency,
            dry_run,
            paymentagent_loginid: loginid,
            paymentagent_withdraw: 1,
            verification_code,
        });

    // Crypto withdraw functionality has been removed

    const cryptoConfig = () =>
        deriv_api.send({
            crypto_config: 1,
        });

    const paymentAgentTransfer = ({ amount, currency, description, transfer_to, dry_run = 0 }) =>
        deriv_api.send({
            amount,
            currency,
            description,
            transfer_to,
            paymentagent_transfer: 1,
            dry_run,
        });

    const activeSymbols = (mode = 'brief') => deriv_api.activeSymbols(mode);

    const transferBetweenAccounts = (account_from, account_to, currency, amount) =>
        deriv_api.send({
            transfer_between_accounts: 1,
            accounts: 'all',
            ...(account_from && {
                account_from,
                account_to,
                currency,
                amount,
            }),
        });

    const forgetStream = id => deriv_api.forget(id);

    const contractUpdate = (contract_id, limit_order) =>
        deriv_api.send({
            contract_update: 1,
            contract_id,
            limit_order,
        });

    const contractUpdateHistory = contract_id =>
        deriv_api.send({
            contract_update_history: 1,
            contract_id,
        });

    const cancelContract = contract_id => deriv_api.send({ cancel: contract_id });

    const fetchLoginHistory = limit =>
        deriv_api.send({
            login_history: 1,
            limit,
        });

    // P2P functionality has been removed
    const accountStatistics = () => deriv_api.send({ account_statistics: 1 });

    const tradingServers = platform => deriv_api.send({ platform, trading_servers: 1 });

    const tradingPlatformNewAccount = values =>
        deriv_api.send({
            trading_platform_new_account: 1,
            ...values,
        });

    const triggerMt5DryRun = ({ email }) =>
        deriv_api.send({
            account_type: 'financial',
            dry_run: 1,
            email,
            leverage: 100,
            mainPassword: 'Test1234',
            mt5_account_type: 'financial_stp',
            mt5_new_account: 1,
            name: 'test real labuan financial stp',
        });

    const getPhoneSettings = () => deriv_api.send({ phone_settings: 1 });

    const getServiceToken = (platform, server) => {
        const temp_service = platform;

        return deriv_api.send({
            service_token: 1,
            service: temp_service,
            server,
        });
    };

    const getSessionToken = oneTimeToken =>
        deriv_api.send({
            get_session_token: oneTimeToken,
        });

    const changeEmail = api_request => deriv_api.send(api_request);

    return {
        init,
        openNewConnection,
        forgetStream,
        wait,
        availability,
        hasReadyState,
        isSiteDown,
        isSiteUpdating,
        clear: () => {
            // do nothing.
        },
        sendBuffered: () => {
            // do nothing.
        },
        getSocket: () => binary_socket,
        get: () => deriv_api,
        getAvailability: () => availability,
        setOnDisconnect: onDisconnect => {
            config.onDisconnect = onDisconnect;
        },
        setOnReconnect: onReconnect => {
            config.onReconnect = onReconnect;
        },
        removeOnReconnect: () => {
            delete config.onReconnect;
        },
        removeOnDisconnect: () => {
            delete config.onDisconnect;
        },
        cache: delegateToObject({}, () => deriv_api.cache),
        storage: delegateToObject({}, () => deriv_api.storage),
        blockRequest,
        buy,
        buyAndSubscribe,
        sell,
        cancelContract,
        close,
        cryptoConfig,
        contractUpdate,
        contractUpdateHistory,
        getFinancialAssessment,
        setFinancialAndTradingAssessment,
        mt5NewAccount,
        newAccountVirtual,
        newAccountReal,
        newAccountRealMaltaInvest,
        getPhoneSettings,
        profitTable,
        statement,
        getTicksHistory,
        tradingPlatformPasswordChange,
        tradingPlatformPasswordReset,
        tradingPlatformAvailableAccounts,
        tradingPlatformInvestorPasswordChange,
        tradingPlatformInvestorPasswordReset,
        activeSymbols,
        paymentAgentList,
        allPaymentAgentList,
        paymentAgentDetails,
        paymentAgentWithdraw,
        paymentAgentTransfer,
        setAccountCurrency,
        setAvailability,
        subscribeBalance,
        subscribeProposal,
        subscribeProposalOpenContract,
        subscribeTicks,
        subscribeTicksHistory,
        subscribeTransaction,
        transferBetweenAccounts,
        fetchLoginHistory,
        closeAndOpenNewConnection,
        connectToOtpUrl,
        accountStatistics,
        tradingServers,
        tradingPlatformNewAccount,
        triggerMt5DryRun,
        getServiceToken,
        getSessionToken,
        changeEmail,
    };
})();

function delegateToObject(base_obj, extending_obj_getter) {
    return new Proxy(base_obj, {
        get(target, field) {
            if (target[field]) return target[field];

            const extending_obj =
                typeof extending_obj_getter === 'function' ? extending_obj_getter() : extending_obj_getter;

            if (!extending_obj) return undefined;

            const value = extending_obj[field];
            if (value) {
                if (typeof value === 'function') {
                    return value.bind(extending_obj);
                }
                return value;
            }

            return undefined;
        },
    });
}

const proxied_socket_base = delegateToObject(BinarySocketBase, () => BinarySocketBase.get());

const proxyForAuthorize = obj =>
    new Proxy(obj, {
        get(target, field) {
            if (target[field] && typeof target[field] !== 'function') {
                return proxyForAuthorize(target[field]);
            }
            return (...args) => BinarySocketBase?.wait('authorize')?.then(() => target[field](...args));
        },
    });

BinarySocketBase.authorized = proxyForAuthorize(proxied_socket_base);

module.exports = proxied_socket_base;
