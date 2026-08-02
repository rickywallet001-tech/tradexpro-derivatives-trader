import React from 'react';

import { Loading } from '@deriv/components';
import { makeLazyLoader, moduleLoader } from '@deriv/shared';
import { TCoreStores } from '@deriv/stores/types';

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

const App = ({ passthrough }: Apptypes) => {
    // Was: isMobile ? <AppV2Loader ... /> : <AppLoader ... />
    // AppV2 is a genuinely separate component tree with its own layout,
    // ordering, and styling decisions -- which is exactly why mobile kept
    // looking different from desktop no matter how many individual AppV2
    // layout issues got fixed one at a time. Forcing the same desktop tree
    // on every device makes mobile structurally identical to desktop
    // (same DOM, same ordering) instead of a separately-maintained,
    // separately-diverging mobile layout.
    return <AppLoader passthrough={passthrough} />;
};
export default App;
