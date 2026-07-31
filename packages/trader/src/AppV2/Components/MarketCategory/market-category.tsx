import React, { useEffect, useRef } from 'react';

import { ActiveSymbols } from '@deriv/api-types';
import { usePrevious } from '@deriv/components';
import { CaptionText, Tab, Text } from '@deriv-com/quill-ui';

import { MarketGroup } from 'AppV2/Utils/symbol-categories-utils';

import FavoriteSymbols from '../FavoriteSymbols';
import MarketCategoryItem from '../MarketCategoryItem';

type TMarketCategory = {
    category: MarketGroup;
    selectedSymbol: string;
    setSelectedSymbol: (input: string) => void;
    setIsOpen: (input: boolean) => void;
    isOpen: boolean;
};

const MarketCategory = ({ category, selectedSymbol, setSelectedSymbol, setIsOpen, isOpen }: TMarketCategory) => {
    const itemRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const prevSymbol = usePrevious(selectedSymbol);

    useEffect(() => {
        if (isOpen && category.market === 'all' && selectedSymbol && itemRefs.current[selectedSymbol] && !prevSymbol) {
            itemRefs.current[selectedSymbol]?.scrollIntoView({ block: 'center' });
        }
    }, [isOpen, category.market, selectedSymbol, prevSymbol]);

    return (
        <Tab.Panel key={category.market_display_name}>
            {category.market !== 'favorites' ? (
                Object.entries(category.subgroups).map(([subgroupKey, subgroup]) => (
                    <div key={subgroupKey} className='market-category-content__container'>
                        {subgroupKey !== 'none' && (
                            <div className='market-category-title__container'>
                                <Text size='sm' className='market-category-title'>
                                    {category.subgroups[subgroupKey].subgroup_display_name}
                                </Text>
                            </div>
                        )}
                        {Object.entries(subgroup.submarkets).map(([submarketKey, submarket]) => (
                            <div className='market-category-body' key={submarketKey}>
                                <CaptionText size='sm' className='market-category-subtitle'>
                                    {submarket.submarket_display_name}
                                </CaptionText>
                                <div className='market-category-items'>
                                    {submarket.items.map((item: ActiveSymbols[0]) => (
                                        <MarketCategoryItem
                                            key={(item as any).underlying_symbol || item.symbol}
                                            ref={
                                                ((item as any).underlying_symbol || item.symbol) === selectedSymbol
                                                    ? el =>
                                                          (itemRefs.current[
                                                              (item as any).underlying_symbol || item.symbol
                                                          ] = el)
                                                    : undefined
                                            }
                                            item={item}
                                            selectedSymbol={selectedSymbol}
                                            setSelectedSymbol={setSelectedSymbol}
                                            setIsOpen={setIsOpen}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ))
            ) : (
                <div>
                    <FavoriteSymbols
                        selectedSymbol={selectedSymbol}
                        setSelectedSymbol={setSelectedSymbol}
                        setIsOpen={setIsOpen}
                    />
                </div>
            )}
        </Tab.Panel>
    );
};

export default MarketCategory;
