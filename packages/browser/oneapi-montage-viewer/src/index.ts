/*
 * MontageViewer custom element.
 */

import {
    Session,
    FieldId,
    FieldType,
    SubscriptionHandle,
    StatusCode,
    TrendType,
    TopicId,
    DataSourceId,
    SymbologyId,
    SubscriptionMessage,
    TRational
} from "@activfinancial/one-api";

import { FieldInfo, tableInfos } from "./tableFields";

import { formatField, applyTrendStyle, clearTrendStyle, getTrendHelperFromString } from "../../common/formatFieldValue";
import { addUnloadHandler } from "../../../common/utils";

// Note leading ! overrides webpack config matching css files.
import commonCss from "!raw-loader!../../common/common.css";
import indexCss from "!raw-loader!../style/index.css";

import indexHtml from "!raw-loader!./index.html";

import { props, withProps, withRenderer, withUnique } from "skatejs";

// TODO can we factor out the attribute names below? Too much repetition.
/** Attributes interface. */
interface Attributes {
    datasourceid: DataSourceId;
    symbologyid: SymbologyId;
    tag: string;
    view: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------

class MontageViewer extends withProps(withRenderer(withUnique(HTMLElement))) {
    private renderRoot!: ShadowRoot;
    private readonly header: HTMLTableElement;
    private readonly body: HTMLTableElement;
    private readonly status: HTMLDivElement;
    private readonly overlay: HTMLDivElement;

    private sessionPromise: Promise<Session> | null = null;
    private session: Session | null = null;
    private subscriptionHandles: SubscriptionHandle[] = [];
    private fieldInfos: FieldInfo[] = [];

    // props.
    private datasourceid: DataSourceId = DataSourceId.activ;
    private symbologyid: SymbologyId = SymbologyId.native;
    private tag: string = "";
    private view: string = "";

    // Used by stats.js in website.
    subscribeTimestamp: number = 0;
    initialResponseTimestamp: number = 0;
    renderingCompleteTimestamp: number = 0;
    responsesReturned: number = 0;
    totalUpdates: number = 0;

    static props = {
        datasourceid: props.number,
        symbologyid: props.number,
        view: props.string,
        /** A delimited list of tag expressions. */
        tag: props.string
    };

    constructor() {
        super();

        const element = document.createElement("div");
        element.className = "activ-one-api-webcomponent montage-viewer";
        element.innerHTML = `<style>${commonCss}${indexCss}</style>${indexHtml}`;

        this.renderRoot.appendChild(element);
        this.header = this.renderRoot.querySelector(".montage-viewer-header-thead") as HTMLTableElement;
        this.body = this.renderRoot.querySelector(".montage-viewer-table-body") as HTMLTableElement;
        this.status = this.renderRoot.querySelector(".montage-viewer-status") as HTMLDivElement;
        this.overlay = this.renderRoot.querySelector(".montage-viewer-overlay") as HTMLDivElement;

        addUnloadHandler(() => this.unsubscribe());

        this.setStatus("Waiting...");
    }

    async connect(sessionPromise: Promise<Session>) {
        if (this.sessionPromise === sessionPromise) {
            return;
        }

        this.sessionPromise = sessionPromise;
        this.setStatus("Connecting...");

        try {
            this.session = await sessionPromise;
        } catch (e) {
            this.setStatus(`Error connecting`);
            throw new Error("Error connecting");
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

        if (this.session == null || this.tag == null || this.view == null) {
            return;
        }

        this.resetStats();
        this.setStatus("Subscribing...");

        try {
            const fieldInfos = tableInfos[this.view];
            this.fieldInfos = fieldInfos != null ? fieldInfos : tableInfos.default;

            // ";" delimited list of tag expressions provided. Split up and create a tagList.
            const tagList = this.tag.split(";");

            let topicIds: TopicId[] = [];

            // Initiate the topic query requests.
            for (const tagExpression of tagList) {
                let topicIdHandle = this.session.query({
                    dataSourceId: this.datasourceid,
                    tagExpression: tagExpression
                });
                for await (let topicIdResult of topicIdHandle) {
                    if (undefined !== topicIdResult.message) {
                        topicIds.push(topicIdResult.message.topicId);
                    } else if (StatusCode.success == topicIdResult.statusCode) {
                        // Initial topic query complete.
                        break;
                    } else {
                        this.setStatus(`Error subscribing: ${StatusCode[topicIdResult.statusCode]}`);
                    }
                }
            }

            this.createHeaderRow();
            this.setStatus(null);

            // Set up subscriptions to the topic ids
            for (const topicId of topicIds) {
                let subscription = this.session.subscribe({
                    dataSourceId: topicId.dataSourceId,
                    symbologyId: this.symbologyid,
                    symbol: topicId.symbol
                });
                this.subscriptionHandles.push(subscription);

                const updateRow = this.createRow();
                (async () => {
                    for await (const response of subscription) {
                        if (0 == this.responsesReturned) {
                            this.initialResponseTimestamp = performance.now();
                        }

                        if (response.statusCode == StatusCode.success && response.message !== undefined) {
                            if (response.message.isRefresh) {
                                this.processRefresh(response.message);
                            } else {
                                ++this.totalUpdates;
                            }

                            updateRow(response.message);
                            if (
                                this.responsesReturned == topicIds.length &&
                                this.renderingCompleteTimestamp == this.subscribeTimestamp
                            ) {
                                this.renderingCompleteTimestamp = performance.now();
                            }
                        } else {
                            this.setStatus(`Error subscribing: ${StatusCode[response.statusCode]}`);
                        }
                    }
                })();
            }
        } catch (e) {
            this.setStatus(`Error subscribing: ${e}`);
        }
    }

    unsubscribe() {
        for (let subscriptionHandle of this.subscriptionHandles) {
            subscriptionHandle.delete();
        }
        this.subscriptionHandles = [];
        this.body.innerHTML = "";
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

    private processRefresh(record: SubscriptionMessage) {
        ++this.responsesReturned;
    }

    private async createHeaderRow() {
        this.header.innerHTML = "";
        const headerRow = this.header.insertRow(0);
        headerRow.className = "montage-viewer-header-row";
        const width = 100 / (this.fieldInfos.length + 1);

        const cell = document.createElement("th");

        cell.textContent = `Symbol`;

        cell.style.width = `${width}%`;
        cell.className = "montage-viewer-header-cell";

        headerRow.appendChild(cell);

        for (const fieldInfo of this.fieldInfos) {
            // Default trending if not specified.
            if (fieldInfo.trendHelper == null) {
                fieldInfo.trendHelper = getTrendHelperFromString(fieldInfo.fieldId, TrendType[TrendType.tick]);
            }

            const cell = document.createElement("th");

            cell.textContent = `${FieldId[fieldInfo.fieldId]}`;

            cell.style.width = `${width}%`;
            cell.className = "montage-viewer-header-cell";

            headerRow.appendChild(cell);
        }
    }

    private createRow() {
        const element = document.createElement("tr");
        element.className = "montage-viewer-row";

        const width = 100 / (this.fieldInfos.length + 1);
        let fieldIdToIndex: number[] = [];

        const cell = document.createElement("td");
        cell.style.width = `${width}%`;
        cell.className = "montage-viewer-row-cell";
        element.appendChild(cell);

        for (let i = 0; i < this.fieldInfos.length; i++) {
            const cell = document.createElement("td");
            cell.style.width = `${width}%`;
            cell.className = "montage-viewer-row-cell";
            element.appendChild(cell);
            fieldIdToIndex[this.fieldInfos[i].fieldId] = i + 1;
        }

        const updateRow = (message: SubscriptionMessage) => {
            const cell = element.children[0] as HTMLTableCellElement;
            cell.textContent = message.symbol;

            for (const field of message.fieldData) {
                const index = fieldIdToIndex[field.id];

                if (index != null && field.doesUpdateLastValue) {
                    const cell = element.children[index] as HTMLTableCellElement;
                    cell.textContent = formatField(field);

                    if (field.type === FieldType.tRational) {
                        applyTrendStyle(this.fieldInfos[index].trendHelper!(field.value as TRational), cell);
                    } else if (field.value == null) {
                        clearTrendStyle(cell);
                    }
                }
            }
        };

        this.body.appendChild(element);

        return updateRow;
    }

    private setStatus(message: string | null) {
        this.status.textContent = message;
        this.overlay.style.display = message == null ? "none" : "";
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

window.customElements.define("montage-viewer", MontageViewer);

export { Attributes };
export default MontageViewer;
