import React from 'react';
import Loadable from 'react-loadable';

import { UILoader } from '@deriv/components';
import { LegacyChartsIcon } from '@deriv/quill-icons';
import { observer, useStore } from '@deriv/stores';
import type { TCoreStores } from '@deriv/stores/types';
import { useTranslations } from '@deriv-com/translations';

import TraderProviders from '../../trader-providers';

type TTradeSettingsExtensionsProps = {
    store: TCoreStores;
};

const ChartSettingContainer = Loadable({
    loader: () =>
        import(/* webpackChunkName: "settings-chart" */ 'App/Containers/SettingsModal/settings-chart').catch(err => {
            // This chunk has repeatedly failed to load in production
            // (503) across multiple redeploys -- removed webpackPrefetch
            // since a browser-level prefetch hint gains nothing for a
            // chunk that's this unreliable, and catching here means a
            // user who actually opens Chart Settings gets a clear error
            // state via react-loadable's `error` prop instead of an
            // unhandled rejection.
            console.error('[TradeSettingsExtensions] settings-chart chunk failed to load', err);
            throw err;
        }),
    loading: ({
        error,
        retry,
        pastDelay,
    }: {
        error?: Error | null;
        retry: () => void;
        pastDelay: boolean;
        isLoading: boolean;
        timedOut: boolean;
    }) => {
        if (error) {
            return (
                <div style={{ padding: 16, textAlign: 'center' }}>
                    <p>{"Couldn't load chart settings."}</p>
                    <button onClick={retry}>Retry</button>
                </div>
            );
        }
        if (pastDelay) return <UILoader />;
        return null;
    },
});

const renderItemValue = <T extends object>(props: T, store: TCoreStores) => (
    <TraderProviders store={store}>
        <ChartSettingContainer {...props} />
    </TraderProviders>
);

const TradeSettingsExtensions = observer(({ store }: TTradeSettingsExtensionsProps) => {
    const { localize } = useTranslations();
    const { ui } = useStore();
    const { populateSettingsExtensions } = ui;
    const populateSettings = () => {
        const menu_items: Parameters<typeof populateSettingsExtensions>[0] = [
            {
                icon: <LegacyChartsIcon />,
                label: localize('Charts'),
                value: props => renderItemValue(props, store),
            },
        ];
        populateSettingsExtensions(menu_items);
    };

    React.useEffect(() => {
        return () => populateSettingsExtensions(null);
    }, [populateSettingsExtensions]);

    React.useEffect(() => populateSettings());

    return null;
});

export default TradeSettingsExtensions;
