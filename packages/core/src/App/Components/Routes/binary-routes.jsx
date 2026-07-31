import React from 'react';
import { Switch, Prompt, useLocation, Redirect } from 'react-router-dom';
import { Loading } from '@deriv/components';
import getRoutesConfig from 'App/Constants/routes-config';
import RouteWithSubRoutes from './route-with-sub-routes.jsx';
import { observer, useStore } from '@deriv/stores';
import { routes } from '@deriv/shared';

// List of route patterns that have been removed
const REMOVED_ROUTE_PATTERNS = [
    /^\/account\/.*/,
    /^\/settings\/.*/,
    /^\/mt5\/.*/,
    /^\/derivx\/.*/,
    /^\/bot\/.*/,
    /^\/account-closed\/?$/,
    /^\/complaints-policy\/?$/,
    /^\/onboarding\/?$/,
    /^\/cfd-compare-accounts\/?$/,
];

// Component to handle redirects for removed routes
const RemovedRoutesRedirect = () => {
    const location = useLocation();

    // Check if current location matches any removed route pattern
    const is_removed_route = REMOVED_ROUTE_PATTERNS.some(pattern => pattern.test(location.pathname));

    // Redirect to trade page if accessing a removed route
    if (is_removed_route) {
        return <Redirect to={routes.index} />;
    }

    return null;
};

const BinaryRoutes = observer(props => {
    const { ui, gtm } = useStore();
    const { promptFn, prompt_when } = ui;
    const { pushDataLayer } = gtm;
    const location = useLocation();

    React.useEffect(() => {
        pushDataLayer({ event: 'page_load' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location]);

    return (
        <React.Suspense fallback={<Loading />}>
            <Prompt when={prompt_when} message={promptFn} />
            <RemovedRoutesRedirect />
            <Switch>
                {getRoutesConfig().map((route, idx) => (
                    <RouteWithSubRoutes key={idx} {...route} {...props} />
                ))}
            </Switch>
        </React.Suspense>
    );
});

export default BinaryRoutes;
