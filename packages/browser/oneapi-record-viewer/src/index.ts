/**
 * RecordViewer custom element.
 */

import {
    Field,
    FieldId,
    FieldType,
    TRational,
    StatusCode,
    Session,
    SubscriptionMessage,
    SubscriptionHandle,
    DataSourceId,
    Dictionary,
    SymbologyId,
    ConflationType,
    Handle,
    getExchangeCode
} from "@activfinancial/one-api";

import { formatField as formatFieldInternal, applyTrendStyle, clearTrendStyle } from "../../common/formatFieldValue";
import { addUnloadHandler, getExchangeName } from "../../../common/utils";

// Note leading ! overrides webpack config matching css files.
import commonCss from "!raw-loader!../../common/common.css";
import indexCss from "!raw-loader!../style/index.css";

import indexHtml from "!raw-loader!./index.html";
import fieldHtml from "!raw-loader!./field.html";

import { props, withProps, withRenderer, withUnique } from "skatejs";

// ---------------------------------------------------------------------------------------------------------------------------------

/** "---" for undefined fields. */
function formatField(field: Field): string {
    return formatFieldInternal(field, { undefinedText: "---" });
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** State of each field. */
interface FieldData {
    /** Display name for field. */
    name: string;

    /** Renderer. */
    render: (field: Field, isVisible: boolean) => void;

    /** Current value (for redrawing after filter change). */
    field: Field;

    /** Whether the field is visible due to the filter. */
    isVisible: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------------

interface Attributes {
    datasourceid: DataSourceId;
    symbologyid: SymbologyId;
    symbol: string;
    conflationtype: ConflationType;
    conflationinterval: number;
}

// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * RecordViewer WebComponent.
 */
class RecordViewer extends withProps(withRenderer(withUnique(HTMLElement))) {
    // TODO get rid of the !
    private renderRoot!: ShadowRoot;
    private readonly symbolLabel: HTMLHeadingElement;
    private readonly exchangeLabel: HTMLHeadingElement;
    private readonly filterValue: HTMLInputElement;
    private readonly body: HTMLTableElement;
    private readonly status: HTMLDivElement;
    private readonly overlay: HTMLDivElement;

    private sessionPromise: Promise<Session> | null = null;
    private session: Session | null = null;
    private subscriptionParametersHandle: Handle | null = null;
    private subscriptionHandle: SubscriptionHandle | null = null;
    private dictionary: Dictionary | null = null;
    private companyName: string = "";
    private exchangeName: string = "";

    private fields: FieldData[] = [];

    // Used by stats.js in website.
    subscribeTimestamp: number = 0;
    initialResponseTimestamp: number = 0;
    renderingCompleteTimestamp: number = 0;
    responsesReturned: number = 0;
    totalUpdates: number = 0;

    // A Field to represent UpdateId, as it isn't in FieldData in an update.
    private updateIdField = {
        id: FieldId.FID_UPDATE_ID,
        isDefined: true,
        doesUpdateLastValue: true,
        type: FieldType.uInt,
        value: 0
    };

    // props.
    private datasourceid: number = DataSourceId.activ;
    private symbologyid: number = SymbologyId.native;
    private symbol: string | null = null;
    private conflationtype: number = ConflationType.none;
    private conflationinterval: number = 100;

    static props = {
        datasourceid: props.number,
        symbologyid: props.number,
        symbol: props.string,
        conflationtype: props.number,
        conflationinterval: props.string
    };

    constructor() {
        super();

        const element = document.createElement("div");
        element.className = "activ-one-api-webcomponent record-viewer";
        element.innerHTML = `<style>${commonCss}${indexCss}</style>${indexHtml}`;
        this.renderRoot.appendChild(element);
        this.symbolLabel = this.renderRoot.querySelector(".record-viewer-title-symbol") as HTMLHeadingElement;
        this.exchangeLabel = this.renderRoot.querySelector(".record-viewer-title-exchange") as HTMLHeadingElement;

        // Function for any activity in the filter input; just redraw display after updating visible state for all fields.
        const handleFilterEvent = (e: Event) => {
            e.preventDefault();

            for (const fieldData of this.fields) {
                if (fieldData != null) {
                    fieldData.isVisible = this.isFieldVisible(fieldData.name);
                }
            }

            this.renderAllFields();
        };

        const filterForm = this.renderRoot.querySelector(".record-viewer-filter-form") as HTMLFormElement;
        filterForm.addEventListener("submit", handleFilterEvent);

        this.filterValue = this.renderRoot.querySelector(".record-viewer-filter-value") as HTMLInputElement;
        this.filterValue.addEventListener("keyup", handleFilterEvent);
        this.filterValue.addEventListener("search", handleFilterEvent);
        this.filterValue.addEventListener("change", handleFilterEvent);

        this.body = this.renderRoot.querySelector(".record-viewer-body") as HTMLTableElement;
        this.status = this.renderRoot.querySelector(".record-viewer-status") as HTMLDivElement;
        this.overlay = this.renderRoot.querySelector(".record-viewer-overlay") as HTMLDivElement;

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
            let reason = "unknown";
            if (typeof e === "number") reason = `${StatusCode[e]}`;
            this.setStatus(`Error connecting: ${reason}`);
            throw new Error("Error connecting");
        }
        this.dictionary = this.session.getMetadata().getDataSourceDictionary(this.datasourceid);
        this.setStatus("Connected");

        try {
            this.subscribe();

            // Wait for a break or disconnection.
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

        this.symbolLabel.textContent = this.symbol || "";
        if (this.session == null || this.symbol == null) {
            return;
        }

        this.resetStats();
        this.setStatus("Subscribing...");

        try {
            // Look up the company symbol.
            const companyTopicIdHandle = this.session.query({
                dataSourceId: this.datasourceid,
                tagExpression: `symbol=${this.symbol} navigate=company`
            });
            let companySymbol = null;
            for await (let topicIdResult of companyTopicIdHandle) {
                if (undefined !== topicIdResult.message) {
                    companySymbol = topicIdResult.message.topicId.symbol;
                    break;
                } else {
                    this.setStatus(`Error finding company: ${StatusCode[topicIdResult.statusCode]}`);
                }
            }
            companyTopicIdHandle.delete();

            // Get a snapshot of the data for the company.
            if (null != companySymbol) {
                const companyResultPromise = this.session.snapshot({
                    dataSourceId: this.datasourceid,
                    symbol: companySymbol
                });

                const companyMessage = await companyResultPromise;
                if (companyMessage.fieldData.isFieldPresent(FieldId.FID_NAME)) {
                    this.companyName = companyMessage.fieldData.getField(FieldId.FID_NAME).value!.toString();
                }
                companyMessage.delete();
            }

            this.exchangeLabel.textContent = await this.exchangeToString();

            // Set up any subscription parameters.
            if (this.conflationtype != ConflationType.none) {
                console.log(
                    "Setting conflation to type '" +
                        ConflationType[this.conflationtype] +
                        "' with interval " +
                        this.conflationinterval
                );
                this.subscriptionParametersHandle = this.session.registerSubscriptionParameters({
                    conflationParameters: {
                        conflationInterval: this.conflationinterval,
                        conflationType: this.conflationtype
                    }
                });
            }

            // Initiate the async request.
            this.subscriptionHandle = this.session.subscribe(
                {
                    dataSourceId: this.datasourceid,
                    symbologyId: this.symbologyid,
                    symbol: this.symbol
                },
                this.subscriptionParametersHandle == null ? undefined : this.subscriptionParametersHandle
            );

            // Asynchonously iterate over the messages.
            for await (const response of this.subscriptionHandle) {
                this.setStatus(null);
                if (0 == this.responsesReturned) {
                    this.initialResponseTimestamp = performance.now();
                }

                if (response.statusCode == StatusCode.success && response.message !== undefined) {
                    if (response.message.isRefresh) {
                        this.processRefresh(response.message);
                        if (1 == this.responsesReturned) {
                            this.renderingCompleteTimestamp = performance.now();
                        }
                    } else {
                        this.processUpdate(response.message);
                    }
                } else {
                    this.setStatus(`Error subscribing: ${StatusCode[response.statusCode]}`);
                }
            }
        } catch (e) {
            let reason = "unknown";
            if (typeof e === "number") reason = `${StatusCode[e]}`;
            this.setStatus("Error subscribing: " + reason);
        }
    }

    unsubscribe() {
        if (this.subscriptionHandle != null) {
            this.subscriptionHandle.delete();
            this.subscriptionHandle = null;
        }
        if (this.subscriptionParametersHandle != null) {
            this.subscriptionParametersHandle.delete();
            this.subscriptionParametersHandle = null;
        }
        this.exchangeName = "";
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

    private async processRefresh(record: SubscriptionMessage) {
        ++this.responsesReturned;
        this.fields = [];

        for (const field of record.fieldData) {
            const fieldName = null === this.dictionary ? field.id.toString() : this.dictionary.getFieldName(field.id);
            const fieldData = {
                name: fieldName,
                render: this.createFieldElement(fieldName, fieldName),
                field,
                isVisible: this.isFieldVisible(fieldName)
            };

            // Render the initial value.
            fieldData.render(field, fieldData.isVisible);

            this.fields[field.id] = fieldData;
        }
    }

    private processUpdate(update: SubscriptionMessage) {
        ++this.totalUpdates;
        for (const field of update.fieldData) {
            if (field.doesUpdateLastValue) {
                this.updateField(field);
            }
        }

        // Special case for updateId as it's not in FieldData.
        this.updateIdField.value = update.updateId;
        this.updateField(this.updateIdField);
    }

    private async exchangeToString() {
        let res = this.companyName;

        this.exchangeName = await getExchangeName(getExchangeCode(this.symbol!), this.session!);
        if (this.exchangeName.length > 0) {
            if (res.length > 0) {
                res += " ";
            }

            res += `(${this.exchangeName})`;
        }

        return res;
    }

    private updateField(field: Field) {
        const fieldData = this.fields[field.id];
        if (fieldData != null) {
            fieldData.render(field, fieldData.isVisible);

            // Cache value for redrawing after a filter change.
            fieldData.field = field;
        }
    }

    private createFieldElement(fieldName: string, fieldDescription: string) {
        const element = document.createElement("div");
        element.className = "record-viewer-field";
        element.innerHTML = fieldHtml;

        const nameElement = element.querySelector(".record-viewer-field-name") as HTMLDivElement;
        nameElement.textContent = fieldName;
        nameElement.title = fieldDescription;

        const valueElement = element.querySelector(".record-viewer-field-value") as HTMLDivElement;

        const renderField = (field: Field, isVisible: boolean) => {
            element.style.display = isVisible ? "" : "none";
            valueElement.textContent = formatField(field);

            if (field.type === FieldType.tRational) {
                applyTrendStyle((field.value as TRational).trends.tick, valueElement);
            } else if (field.value == null) {
                clearTrendStyle(valueElement);
            }
        };

        this.body.appendChild(element);

        return renderField;
    }

    private isFieldVisible(fieldName: string): boolean {
        return fieldName.toLowerCase().includes(this.filterValue.value.toLowerCase());
    }

    private renderAllFields() {
        for (const fieldData of this.fields) {
            if (fieldData != null) {
                fieldData.render(fieldData.field, fieldData.isVisible);
            }
        }
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

window.customElements.define("record-viewer", RecordViewer);

export { Attributes };
export default RecordViewer;
