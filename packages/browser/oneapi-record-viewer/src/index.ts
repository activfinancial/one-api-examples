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
    DictionaryId,
    DictionaryHelper,
    SymbologyId,
    PlatformFieldId
} from "@activfinancial/one-api";

import { formatField as formatFieldInternal, applyTrendStyle, clearTrendStyle } from "../../common/formatFieldValue";
import { addUnloadHandler } from "../../../common/utils";

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
}

// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * RecordViewer WebComponent.
 */
class RecordViewer extends withProps(withRenderer(withUnique(HTMLElement))) {
    // TODO get rid of the !
    private renderRoot!: ShadowRoot;
    private readonly symbolLabel: HTMLHeadingElement;
    private readonly filterValue: HTMLInputElement;
    private readonly body: HTMLTableElement;
    private readonly status: HTMLDivElement;
    private readonly overlay: HTMLDivElement;

    private sessionPromise: Promise<Session> | null = null;
    private session: Session | null = null;
    private dictionaryId: number = DictionaryId.activ;
    private dictionaryHelper: DictionaryHelper | null = null;
    private subscriptionHandle: SubscriptionHandle | null = null;

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

    static props = {
        datasourceid: props.number,
        symbologyid: props.number,
        symbol: props.string
    };

    constructor() {
        super();

        const element = document.createElement("div");
        element.className = "activ-one-api-webcomponent record-viewer";
        element.innerHTML = `<style>${commonCss}${indexCss}</style>${indexHtml}`;
        this.renderRoot.appendChild(element);
        this.symbolLabel = this.renderRoot.querySelector(".record-viewer-title-symbol") as HTMLHeadingElement;

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
            this.setStatus(`Error connecting`);
            throw new Error("Error connecting");
        }
        this.setStatus("Connected");

        try {
            this.setStatus("Getting meta data");
            const metadataResponse = await this.session.snapshot({
                dataSourceId: DataSourceId.local,
                symbol: "gateway/data-source/" + this.datasourceid.toString()
            });
            if (metadataResponse.fieldData.isFieldPresent(PlatformFieldId.FID_DICTIONARY)) {
                const field = metadataResponse.fieldData.getField(PlatformFieldId.FID_DICTIONARY);
                if (field.isDefined) this.dictionaryId = field.value as number;
            }
            metadataResponse.delete();
        } catch (e) {
            this.setStatus(`Error fetching meta data`);
        }

        try {
            this.setStatus("Getting dictionary helper");
            this.dictionaryHelper = await this.session.getDictionaryHelper(this.dictionaryId);
        } catch (e) {
            this.setStatus(`Error fetching dictionary helper`);
        }

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
            // Initiate the async request.
            this.subscriptionHandle = this.session.subscribe({
                dataSourceId: this.datasourceid,
                symbologyId: this.symbologyid,
                symbol: this.symbol
            });

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
            this.setStatus(`Error subscribing: ${StatusCode[e]}`);
        }
    }

    unsubscribe() {
        if (this.subscriptionHandle != null) {
            this.subscriptionHandle.delete();
            this.subscriptionHandle = null;
        }
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
            let fieldName = field.id.toString();
            if (null != this.dictionaryHelper) {
                let fieldInfo = this.dictionaryHelper.getFieldInfo(field.id);
                fieldName = fieldInfo.name;
            }
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
