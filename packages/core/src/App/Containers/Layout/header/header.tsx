import React from 'react';
import { makeLazyLoader, moduleLoader } from '@deriv/shared';
import { observer } from '@deriv/stores';
import classNames from 'classnames';

const HeaderFallback = () => {
    return <div className={classNames('header')} />;
};

const HeaderLegacy = makeLazyLoader(
    () => moduleLoader(() => import(/* webpackChunkName: "dtrader-header" */ './header-legacy')),
    () => <HeaderFallback />
)();

const Header = observer(() => {
    // When embedded (e.g. tradexpro.co.ke's Manual Traders iframe), the shell
    // already renders its own nav bar with balance, account switcher, and
    // login state -- this header just duplicates all of that with its own
    // logo/login button/trade-type tabs, which is what caused the stacked
    // double-header look reported on mobile. Desktop apparently didn't show
    // this as a visible problem, but hiding it there too is consistent with
    // the same reasoning and shouldn't make anything worse.
    if (window.self !== window.top) return null;
    return <HeaderLegacy />;
});

export default Header;
