import React from 'react';

import { Loading } from '@deriv/components';
import { getPositionsV2TabIndexFromURL, makeLazyLoader, moduleLoader, routes } from '@deriv/shared';
import { TCoreStores } from '@deriv/stores/types';
import { useDevice } from '@deriv-com/ui';

import { TWebSocket } from 'Types';

type Apptypes = {
    passthrough: {
        root_store: TCoreStores;
        WS: TWebSocket;
    };
};

const AppLoader = makeLazyLoader(
    () => moduleLoader(() => import(/* webpackChunkName: "trader-app", webpackPreload: true */ './App/index')),
    () => <Loading />
)() as React.ComponentType<Apptypes>;

const AppV2Loader = makeLazyLoader(
    () => moduleLoader(() => import(/* webpackChunkName: "trader-app-v2", webpackPreload: true */ './AppV2/index')),
    () => (
        <Loading.DTraderV2
            initial_app_loading
            is_contract_details={window.location.pathname.startsWith('/contract/')}
            is_positions={window.location.pathname === routes.trader_positions}
            is_closed_tab={getPositionsV2TabIndexFromURL() === 1}
        />
    )
)() as React.ComponentType<Apptypes>;

const App = ({ passthrough }: Apptypes) => {
    // Reverted forcing AppLoader on all devices (was: da35194a47) -- that
    // rendered essentially blank on an actual phone, confirmed by
    // screenshot, not just unpolished. The desktop tree simply isn't built
    // to render at a narrow viewport at all. AppV2 (with the layout fixes
    // already applied: collapsed panel by default, pinned Buy button,
    // expanded-panel scroll safety net, hidden duplicate header when
    // embedded) is the right base for mobile -- it's a working mobile UI
    // that needs targeted fixes, not a broken one to replace wholesale.
    const { isMobile } = useDevice();
    return isMobile ? <AppV2Loader passthrough={passthrough} /> : <AppLoader passthrough={passthrough} />;
};
export default App;
