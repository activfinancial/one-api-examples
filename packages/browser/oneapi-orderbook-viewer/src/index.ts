/*
 * MontageViewer custom element.
 */

import {
    Session,
    SubscriptionHandle,
    StatusCode,
    UpdateType,
    DataSourceId,
    SubscriptionMessage,
    SymbologyId
} from "@activfinancial/one-api";

import { addUnloadHandler } from "../../../common/utils";

// Note leading ! overrides webpack config matching css files.
import commonCss from "!raw-loader!../../common/common.css";
import indexCss from "!raw-loader!../style/index.css";

import indexHtml from "!raw-loader!./index.html";
import orderRowHtml from "!raw-loader!./orderRow.html";

import { props, withProps, withRenderer, withUnique } from "skatejs";
import { OrderEntry } from "./orderEntry";

// TODO can we factor out the attribute names below? Too much repetition.
/** Attributes interface. */
interface Attributes {
    datasourceid: DataSourceId;
    symbologyid: SymbologyId;
    symbol: string;
    maxrows: number;
}

// ---------------------------------------------------------------------------------------------------------------------------------

class OrderbookViewer extends withProps(withRenderer(withUnique(HTMLElement))) {
    private renderRoot!: ShadowRoot;
    private readonly symbolLabel: HTMLHeadingElement;
    private readonly body: HTMLTableElement;
    private readonly status: HTMLDivElement;
    private readonly overlay: HTMLDivElement;

    private sessionPromise: Promise<Session> | null = null;
    private session: Session | null = null;
    private subscriptionHandle: SubscriptionHandle | null = null;
    private orderMap: Map<string, OrderEntry> = new Map();
    private buyOrderMap: Map<number, Set<string>> = new Map();
    private orderedBuyPrices: number[] = [];
    private sellOrderMap: Map<number, Set<string>> = new Map();
    private orderedSellPrices: number[] = [];

    // props.
    private datasourceid: number = DataSourceId.activ;
    private symbologyid: number = SymbologyId.native;
    private symbol: string = "";
    private maxrows: number = 50;
    private useAsciiOrderId: boolean = false;

    // Used by stats.js in website.
    subscribeTimestamp: number = 0;
    initialResponseTimestamp: number = 0;
    renderingCompleteTimestamp: number = 0;
    responsesReturned: number = 0;
    totalUpdates: number = 0;

    static props = {
        datasourceid: props.number,
        symbologyid: props.number,
        symbol: props.string,
        maxrows: props.number,
        useAsciiOrderId: props.boolean
    };

    constructor() {
        super();

        const element = document.createElement("div");
        element.className = "activ-one-api-webcomponent orderbook-viewer";
        element.innerHTML = `<style>${commonCss}${indexCss}</style>${indexHtml}`;

        this.renderRoot.appendChild(element);
        this.body = this.renderRoot.querySelector(".orderbook-viewer-table-body") as HTMLTableElement;
        this.status = this.renderRoot.querySelector(".orderbook-viewer-status") as HTMLDivElement;
        this.overlay = this.renderRoot.querySelector(".orderbook-viewer-overlay") as HTMLDivElement;
        this.symbolLabel = this.renderRoot.querySelector(".orderbook-viewer-title-symbol") as HTMLHeadingElement;

        addUnloadHandler(() => this.unsubscribe());

        this.setStatus("Waiting...");
    }

    async connect(sessionPromise: Promise<Session>) {
        if (this.sessionPromise === sessionPromise) {
            return;
        }

        this.sessionPromise = sessionPromise;
        this.setStatus("Connecting...");
        this.buildTable();

        try {
            this.session = await sessionPromise;
        } catch (e) {
            this.setStatus(`Error connecting`);
            return;
        }

        try {
            this.setStatus("Connected");

            this.subscribe();

            await this.session.disconnected;
            this.setStatus("Disconnected");
        } catch (e) {
            this.setStatus(`Connection broken`);
        } finally {
            this.unsubscribe();
            this.session = null;
        }
    }

    propsChangedCallback(next: any, prev: any) {
        this.subscribe();
    }

    async subscribe() {
        this.unsubscribe();

        if (this.session == null || this.symbol == null) {
            return;
        }

        this.resetStats();
        this.setStatus("Subscribing...");
        this.symbolLabel.textContent = this.symbol || "";

        try {
            // Set up subscription
            this.subscriptionHandle = this.session.subscribe({
                dataSourceId: this.datasourceid,
                symbologyId: this.symbologyid,
                symbol: this.symbol
            });

            for await (const response of this.subscriptionHandle) {
                this.setStatus(null);

                if (response.statusCode == StatusCode.success && response.message !== undefined) {
                    this.processMessage(response.message);
                } else {
                    this.setStatus(`Error subscribing: ${StatusCode[response.statusCode]}`);
                }
            }
        } catch (e) {
            this.setStatus(`Error subscribing`);
        }
    }

    unsubscribe() {
        if (this.subscriptionHandle !== null) {
            this.subscriptionHandle.delete();
            this.subscriptionHandle = null;
        }
        this.orderMap.clear();
        this.buyOrderMap.clear();
        this.sellOrderMap.clear();
        this.orderedBuyPrices = [];
        this.orderedSellPrices = [];

        this.body.innerHTML = "";
        this.buildTable();
    }

    getStats() {
        return {
            subscribeTimestamp: this.subscribeTimestamp,
            initialResponseTimestamp: this.initialResponseTimestamp,
            renderingCompleteTimestamp: this.renderingCompleteTimestamp,
            responsesReturned: this.responsesReturned,
            totalUpdates: this.totalUpdates
        };
    }

    private resetStats() {
        this.subscribeTimestamp = performance.now();
        this.initialResponseTimestamp = this.subscribeTimestamp;
        this.renderingCompleteTimestamp = this.subscribeTimestamp;
        this.responsesReturned = 0;
        this.totalUpdates = 0;
    }

    private processMessage(record: SubscriptionMessage) {
        let displayRow;
        if (undefined !== record.mapKey) {
            if (record.isRefresh) {
                ++this.responsesReturned;
                if (1 == this.responsesReturned) {
                    this.initialResponseTimestamp = performance.now();
                }
            } else {
                ++this.totalUpdates;
            }

            if (
                record.isRefresh ||
                (undefined !== record.updateType &&
                    (UpdateType.mapAdd == record.updateType || UpdateType.mapUpdate == record.updateType))
            ) {
                const newEntry = !this.orderMap.has(record.mapKey);
                let existingOrderEntry;
                if (!newEntry) {
                    existingOrderEntry = this.orderMap.get(record.mapKey) as OrderEntry;
                    this.removeOrder(existingOrderEntry);
                    this.orderMap.delete(record.mapKey);
                }
                const orderEntry = new OrderEntry(record, existingOrderEntry, this.useAsciiOrderId);
                this.orderMap.set(orderEntry.orderKey, orderEntry);

                let map = orderEntry.isBuy ? this.buyOrderMap : this.sellOrderMap;
                if (!map.has(orderEntry.priceDoubleValue)) {
                    map.set(orderEntry.priceDoubleValue, new Set());
                    if (orderEntry.isBuy) {
                        this.orderedBuyPrices = Array.from(map.keys()).sort((a, b) => {
                            return b - a;
                        });
                    } else {
                        this.orderedSellPrices = Array.from(map.keys()).sort((a, b) => {
                            return a - b;
                        });
                    }
                }
                // Note that at this point we know the Set is in the map.
                let orderEntries = map.get(orderEntry.priceDoubleValue) as Set<string>;
                orderEntries.add(orderEntry.orderKey);

                displayRow = this.findDisplayRow(orderEntry);
            } else if (UpdateType.mapRemove == record.updateType) {
                let orderEntry = this.orderMap.get(record.mapKey.toString());
                if (orderEntry !== undefined) {
                    displayRow = this.findDisplayRow(orderEntry);
                    this.removeOrder(orderEntry);
                }
            }
        }

        if (undefined !== displayRow) {
            this.updateDisplay(displayRow);
            if (displayRow == this.maxrows && this.subscribeTimestamp == this.renderingCompleteTimestamp)
                this.renderingCompleteTimestamp = performance.now();
        }
    }

    private removeOrder(orderEntry: OrderEntry) {
        let map = orderEntry.isBuy ? this.buyOrderMap : this.sellOrderMap;
        let orderEntries = map.get(orderEntry.priceDoubleValue);
        if (orderEntries !== undefined) {
            orderEntries.delete(orderEntry.orderKey);
            if (orderEntries.size == 0) {
                map.delete(orderEntry.priceDoubleValue);
                if (orderEntry.isBuy) {
                    this.orderedBuyPrices = Array.from(map.keys()).sort((a, b) => {
                        return b - a;
                    });
                } else {
                    this.orderedSellPrices = Array.from(map.keys()).sort((a, b) => {
                        return a - b;
                    });
                }
            }
        }
        this.orderMap.delete(orderEntry.orderKey);
    }

    private setStatus(message: string | null) {
        this.status.textContent = message;
        this.overlay.style.display = message == null ? "none" : "";
    }

    private buildTable() {
        for (let i = 0; i < this.maxrows; ++i) {
            const rowElement = document.createElement("tr");
            rowElement.className = "orderbook-viewer-order-row";
            rowElement.innerHTML = orderRowHtml;
            this.body.appendChild(rowElement);
        }
    }

    private findDisplayRow(orderEntry: OrderEntry): number | undefined {
        let map = orderEntry.isBuy ? this.buyOrderMap : this.sellOrderMap;
        let prices = orderEntry.isBuy ? this.orderedBuyPrices : this.orderedSellPrices;
        let count = 0;
        for (let price of prices) {
            let orderKeys = map.get(price) as Set<string>;
            for (let orderKey of orderKeys) {
                if (orderKey == orderEntry.orderKey) return count;
                if (count >= this.maxrows) return;
                ++count;
            }
        }
    }

    private updateDisplay(fromRow: number) {
        let rowElements = this.body.querySelectorAll(".orderbook-viewer-order-row") as NodeListOf<HTMLTableRowElement>;
        let buyOrdersDisplay: string[] = this.getDisplayOrders(true);
        let sellOrdersDisplay: string[] = this.getDisplayOrders(false);
        for (let i = fromRow; i < this.maxrows; ++i) {
            let rowElement = rowElements[i];
            this.populateRow(this.orderMap.get(buyOrdersDisplay[i]), this.orderMap.get(sellOrdersDisplay[i]), rowElement);
        }
    }

    private getDisplayOrders(isBuy: boolean) {
        let map = isBuy ? this.buyOrderMap : this.sellOrderMap;
        let prices = isBuy ? this.orderedBuyPrices : this.orderedSellPrices;

        let ordersDisplay: string[] = [];

        let i = 0;
        for (let price of prices) {
            let orderKeys = map.get(price) as Set<string>;
            for (let orderKey of orderKeys.values()) {
                ordersDisplay[i++] = orderKey;
                if (i >= this.maxrows) break;
            }
        }

        return ordersDisplay;
    }

    private populateRow(buy: OrderEntry | undefined, sell: OrderEntry | undefined, rowElement: HTMLTableRowElement) {
        this.populateSide(buy, true, rowElement);
        this.populateSide(sell, false, rowElement);
    }

    private populateSide(orderEntry: OrderEntry | undefined, isBuy: boolean, rowElement: HTMLTableRowElement) {
        const classString = ".orderbook-" + (isBuy ? "buy" : "sell");

        const orderIdCell = rowElement.querySelector(`[data-activ-field-id="FID_ORDER_ID"]${classString}`) as HTMLTableCellElement;
        orderIdCell.textContent = undefined === orderEntry ? "" : orderEntry.orderId;

        const participantCell = rowElement.querySelector(
            `[data-activ-field-id="FID_PARTICIPANT"]${classString}`
        ) as HTMLTableCellElement;
        participantCell.textContent = undefined === orderEntry ? "" : orderEntry.participant;

        const exchangeCell = rowElement.querySelector(
            `[data-activ-message-field="exchange"]${classString}`
        ) as HTMLTableCellElement;
        exchangeCell.textContent = undefined === orderEntry ? "" : orderEntry.exchange;

        const timeCell = rowElement.querySelector(`[data-activ-field-id="FID_ORDER_TIME"]${classString}`) as HTMLTableCellElement;
        timeCell.textContent = undefined === orderEntry ? "" : orderEntry.time;

        const sizeCell = rowElement.querySelector(`[data-activ-field-id="FID_ORDER_SIZE"]${classString}`) as HTMLTableCellElement;
        sizeCell.textContent = undefined === orderEntry ? "" : orderEntry.size;

        const priceCell = rowElement.querySelector(`[data-activ-field-id="FID_ORDER_PRICE"]${classString}`) as HTMLTableCellElement;
        priceCell.textContent = undefined === orderEntry ? "" : orderEntry.price;
    }

    private disconnectedCallback() {
        // HACK skatejs 5.0 doesn't have the withLifecycle mixin. We can't easily bump to 5.2 as there are no Typescript
        // definitions. So we'll override the standard disconnectedCallback() to do cleanup.
        // However, super.disconenctedCallback() seems incessible. So some hacks to get to it...

        const proto = Object.getPrototypeOf(Object.getPrototypeOf(this));
        if (proto != null && proto.disconnectedCallback != null) {
            proto.disconnectedCallback.call(this);
        }

        this.unsubscribe();
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------

window.customElements.define("orderbook-viewer", OrderbookViewer);

export { Attributes };
export default OrderbookViewer;
