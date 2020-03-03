/*
 * Set of fields to display for various tables.
 */

// ---------------------------------------------------------------------------------------------------------------------------------

import { FieldId } from "@activfinancial/one-api";
import { TrendHelper, getValueTrend } from "../../common/formatFieldValue";

// ---------------------------------------------------------------------------------------------------------------------------------

export interface FieldInfo {
    fieldId: FieldId;
    trendHelper?: TrendHelper;
}

// ---------------------------------------------------------------------------------------------------------------------------------

const defaultTable: FieldInfo[] = [
    { fieldId: FieldId.FID_TRADE },
    { fieldId: FieldId.FID_TRADE_EXCHANGE },
    { fieldId: FieldId.FID_NET_CHANGE, trendHelper: getValueTrend },
    { fieldId: FieldId.FID_TRADE_SIZE },
    { fieldId: FieldId.FID_BID },
    { fieldId: FieldId.FID_BID_EXCHANGE },
    { fieldId: FieldId.FID_ASK },
    { fieldId: FieldId.FID_ASK_EXCHANGE },
    { fieldId: FieldId.FID_BID_SIZE },
    { fieldId: FieldId.FID_ASK_SIZE },
    { fieldId: FieldId.FID_TRADE_HIGH },
    { fieldId: FieldId.FID_TRADE_LOW }
];

const listing: FieldInfo[] = [
    { fieldId: FieldId.FID_TRADE },
    { fieldId: FieldId.FID_TRADE_EXCHANGE },
    { fieldId: FieldId.FID_NET_CHANGE, trendHelper: getValueTrend },
    { fieldId: FieldId.FID_TRADE_SIZE },
    { fieldId: FieldId.FID_BID },
    { fieldId: FieldId.FID_BID_EXCHANGE },
    { fieldId: FieldId.FID_ASK },
    { fieldId: FieldId.FID_ASK_EXCHANGE },
    { fieldId: FieldId.FID_BID_SIZE },
    { fieldId: FieldId.FID_ASK_SIZE },
    { fieldId: FieldId.FID_TRADE_HIGH },
    { fieldId: FieldId.FID_TRADE_LOW }
];

const option: FieldInfo[] = [
    { fieldId: FieldId.FID_EXPIRATION_DATE },
    { fieldId: FieldId.FID_TICK_COUNT },
    { fieldId: FieldId.FID_TRADE },
    { fieldId: FieldId.FID_NET_CHANGE, trendHelper: getValueTrend },
    { fieldId: FieldId.FID_BID },
    { fieldId: FieldId.FID_ASK },
    { fieldId: FieldId.FID_TRADE_HIGH },
    { fieldId: FieldId.FID_TRADE_LOW },
    { fieldId: FieldId.FID_OPEN },
    { fieldId: FieldId.FID_CUMULATIVE_VOLUME }
];

const index: FieldInfo[] = [
    { fieldId: FieldId.FID_TRADE },
    { fieldId: FieldId.FID_NET_CHANGE, trendHelper: getValueTrend },
    { fieldId: FieldId.FID_TRADE_TIME },
    { fieldId: FieldId.FID_TRADE_HIGH },
    { fieldId: FieldId.FID_TRADE_LOW },
    { fieldId: FieldId.FID_OPEN },
    { fieldId: FieldId.FID_CLOSE },
    { fieldId: FieldId.FID_TRADE_COUNT }
];

const future: FieldInfo[] = [
    { fieldId: FieldId.FID_TRADE },
    { fieldId: FieldId.FID_NET_CHANGE, trendHelper: getValueTrend },
    { fieldId: FieldId.FID_TRADE_SIZE },
    { fieldId: FieldId.FID_BID },
    { fieldId: FieldId.FID_ASK },
    { fieldId: FieldId.FID_BID_SIZE },
    { fieldId: FieldId.FID_ASK_SIZE },
    { fieldId: FieldId.FID_TRADE_HIGH },
    { fieldId: FieldId.FID_TRADE_LOW },
    { fieldId: FieldId.FID_OPEN },
    { fieldId: FieldId.FID_TRADE_COUNT }
];

const futureOption: FieldInfo[] = [
    { fieldId: FieldId.FID_TRADE },
    { fieldId: FieldId.FID_NET_CHANGE, trendHelper: getValueTrend },
    { fieldId: FieldId.FID_TRADE_SIZE },
    { fieldId: FieldId.FID_BID },
    { fieldId: FieldId.FID_ASK },
    { fieldId: FieldId.FID_BID_SIZE },
    { fieldId: FieldId.FID_ASK_SIZE },
    { fieldId: FieldId.FID_TRADE_HIGH },
    { fieldId: FieldId.FID_TRADE_LOW },
    { fieldId: FieldId.FID_OPEN },
    { fieldId: FieldId.FID_TRADE_COUNT }
];

const strategy: FieldInfo[] = [
    { fieldId: FieldId.FID_TRADE },
    { fieldId: FieldId.FID_NET_CHANGE, trendHelper: getValueTrend },
    { fieldId: FieldId.FID_TRADE_SIZE },
    { fieldId: FieldId.FID_BID },
    { fieldId: FieldId.FID_ASK },
    { fieldId: FieldId.FID_BID_SIZE },
    { fieldId: FieldId.FID_ASK_SIZE },
    { fieldId: FieldId.FID_TRADE_HIGH },
    { fieldId: FieldId.FID_TRADE_LOW },
    { fieldId: FieldId.FID_OPEN },
    { fieldId: FieldId.FID_TRADE_COUNT }
];

const marketMaker: FieldInfo[] = [
    { fieldId: FieldId.FID_BID },
    { fieldId: FieldId.FID_BID_SIZE },
    { fieldId: FieldId.FID_BID_TIME },
    { fieldId: FieldId.FID_ASK },
    { fieldId: FieldId.FID_ASK_SIZE },
    { fieldId: FieldId.FID_ASK_TIME }
];

const mutualFund: FieldInfo[] = [
    { fieldId: FieldId.FID_NAV },
    { fieldId: FieldId.FID_NET_CHANGE, trendHelper: getValueTrend },
    { fieldId: FieldId.FID_OFFER },
    { fieldId: FieldId.FID_MARKET_PRICE },
    { fieldId: FieldId.FID_NAV_TIME },
    { fieldId: FieldId.FID_CLOSE },
    { fieldId: FieldId.FID_DIVIDEND },
    { fieldId: FieldId.FID_SPLIT_RATIO },
    { fieldId: FieldId.FID_CAP_GAINS_SHORT },
    { fieldId: FieldId.FID_CAP_GAINS_LONG },
    { fieldId: FieldId.FID_CAP_GAINS_OTHER },
    { fieldId: FieldId.FID_ASSETS },
    { fieldId: FieldId.FID_DIVIDEND_REINVEST_PRICE },
    { fieldId: FieldId.FID_DIVIDEND_REINVEST_PRICE_DATE },
    { fieldId: FieldId.FID_CAP_GAINS_REINVEST_PRICE },
    { fieldId: FieldId.FID_CAP_GAINS_REINVEST_PRICE_DATE }
];

const latency: FieldInfo[] = [
    { fieldId: FieldId.FID_LAST_REPORTED_TRADE },
    { fieldId: FieldId.FID_SYSTEM_LATENCY },
    { fieldId: FieldId.FID_SYSTEM_TIMESTAMP }
];

// ---------------------------------------------------------------------------------------------------------------------------------

export const tableInfos: { [name: string]: FieldInfo[] } = {
    default: defaultTable,
    listing: listing,
    option: option,
    index: index,
    future: future,
    futureOption: futureOption,
    strategy: strategy,
    marketMaker: marketMaker,
    mutualFund: mutualFund,
    latency: latency
};
