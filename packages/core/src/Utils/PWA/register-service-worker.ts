import { getUrlBase } from '@deriv/shared';

const EVERY_HOUR = 3600000; // 1000 * 60 * 60

let interval_id: NodeJS.Timeout | undefined;

function refreshOnUpdate() {
    return (swRegistrationObject: ServiceWorkerRegistration) => {
        swRegistrationObject.onupdatefound = () => {
            const updatingWorker = swRegistrationObject.installing;
            if (updatingWorker) {
                updatingWorker.onstatechange = () => {
                    if (updatingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // eslint-disable-next-line no-console
                        console.log('New version is found, refreshing the page...');
                        if (interval_id) {
                            clearInterval(interval_id);
                        }
                    }
                };
            }
        };
    };
}

export default function register() {
    // Register the service worker
    if (/* process.env.NODE_ENV === 'production' && */ 'serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            const sw_url = `${window.location.origin}${getUrlBase('/service-worker.js')}`;

            // Defensive cleanup: a service worker registered by a *previous,
            // unrelated* deployment at this same origin (e.g. an earlier
            // build that isn't this app) keeps controlling the page and
            // serving its own cached assets/behaviour until it's explicitly
            // unregistered -- deploying new code to the server does not
            // remove it from browsers that already installed it. That can
            // manifest as: requests for assets this app never references,
            // and/or the service worker's fetch handler intercepting and
            // failing requests (including auth calls) that were never meant
            // to go through it. Unregister anything whose active script
            // doesn't match this app's own service worker before proceeding.
            navigator.serviceWorker
                .getRegistrations()
                .then(registrations => {
                    registrations.forEach(reg => {
                        const activeUrl = reg.active?.scriptURL;
                        if (activeUrl && activeUrl !== sw_url) {
                            // eslint-disable-next-line no-console
                            console.log('[SW cleanup] Unregistering stale/unrelated service worker:', activeUrl);
                            reg.unregister();
                        }
                    });
                })
                .catch(error => {
                    // eslint-disable-next-line no-console
                    console.error('Error while checking for stale service workers:', error);
                });

            navigator.serviceWorker
                .register(sw_url)
                .then(registration => {
                    interval_id = setInterval(() => {
                        registration
                            .update()
                            .then(refreshOnUpdate)
                            .catch(error => {
                                console.error('Error during service worker update:', error); // eslint-disable-line no-console
                            });
                    }, EVERY_HOUR);

                    registration.onupdatefound = () => {
                        const installingWorker = registration.installing;
                        if (installingWorker) {
                            installingWorker.onstatechange = () => {
                                if (installingWorker.state === 'installed') {
                                    if (navigator.serviceWorker.controller && performance.now() > EVERY_HOUR) {
                                        // User's first visit:
                                        // At this point, the old content will have been purged and
                                        // the fresh content will have been added to the cache.
                                        // It's the perfect time to display a "New content is
                                        // available; please refresh." message in your web app.
                                        const new_version_received = new Event('UpdateAvailable');
                                        document.dispatchEvent(new_version_received);
                                    } else {
                                        // At this point, everything has been precached.
                                        // It's the perfect time to display a
                                        // "Content is cached for offline use." message.
                                    }
                                }
                            };
                        }
                    };
                })
                .catch(error => {
                    console.error('Error during service worker registration:', error, sw_url); // eslint-disable-line no-console
                });
        });
    }
}

export function unregister() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
            registration.unregister();
        });
    }
}
