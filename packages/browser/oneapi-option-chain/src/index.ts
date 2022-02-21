/*
 * OptionChain custom element.
 */

import {
    Session,
    Field,
    FieldData,
    FieldId,
    FieldType,
    getExchangeCode,
    StatusCode,
    SymbolSeparator,
    Trend,
    TRational,
    SubscriptionMessage,
    ConflationType,
    DataSourceId,
    SubscriptionHandle,
    SubscriptionResult,
    TopicQueryResult,
    Handle,
    Dictionary,
    TopicId
} from "@activfinancial/one-api";

import {
    applyTrendStyle,
    clearTrendStyle,
    getTrendHelperFromElement,
    formatField,
    FormatFieldOptions,
    NumberFormat
} from "../../common/formatFieldValue";
import { addUnloadHandler, getExchangeName } from "../../../common/utils";

import { props, withProps, withRenderer, withUnique } from "skatejs";

// Note leading ! overrides webpack config matching css files.
import commonCss from "!raw-loader!../../common/common.css";
import indexCss from "!raw-loader!../style/index.css";

import indexHtml from "!raw-loader!./index.html";
import optionRowHtml from "!raw-loader!./optionRow.html";
import expirationSectionHtml from "!raw-loader!./expirationSection.html";

// ---------------------------------------------------------------------------------------------------------------------------------

interface FieldInfo extends FormatFieldOptions {
    element: HTMLElement;
    getTrend: (value: TRational) => Trend;
}

type UnderlyingFieldInfo = { [key in FieldId]?: FieldInfo };

interface OptionRow {
    strikePrice: number;
    root: string; // For ordering.
    exchangeCode: string; // For ordering.
    element: HTMLElement;

    updateCallOption: (image: SubscriptionMessage) => void;
    updatePutOption: (image: SubscriptionMessage) => void;
    updateInTheMoney: (previousUnderlyingPrice: number | null, underlyingPrice: number) => void;
}

interface ExpirationSection {
    expirationDate: Date;
    element: HTMLElement;
    headerElement: HTMLElement;
    optionRowsElement: HTMLElement;
    optionRows: OptionRow[];
}

interface OptionSubscription {
    subscriptionHandle: SubscriptionHandle;
    expirationSection?: ExpirationSection;
    row?: OptionRow;
    updateOption?: (image: SubscriptionMessage) => void;
}

type OptionChainData = ExpirationSection[];

// ---------------------------------------------------------------------------------------------------------------------------------

const dateFormat = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
});

const percentFormat = {
    format: (value: number) => `${value}%`
};

// ---------------------------------------------------------------------------------------------------------------------------------

// TODO surely we can automagically generate this (or vice-versa) from the props static below? Too much repetition.
/** Attributes interface. */
interface Attributes {
    symbol: string;
    "relationship-id": string;
    "conflation-type": "none" | keyof typeof ConflationType;
    "conflation-interval": number;
}

// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * OptionChain class.
 */
class OptionChain extends withProps(withRenderer(withUnique(HTMLElement))) {
    private renderRoot!: ShadowRoot;
    private readonly rootElement: HTMLDivElement;
    private readonly options: HTMLDivElement;
    private readonly status: HTMLDivElement;
    private readonly overlay: HTMLDivElement;

    private sessionPromise: Promise<Session> | null = null;
    private session: Session | null = null;
    private subscriptionParametersHandle: Handle | null = null;
    private underlyingSubscription: SubscriptionHandle | null = null;
    private optionSubscriptions: Map<string, OptionSubscription> = new Map<string, OptionSubscription>();
    private optionChainData: OptionChainData = [];
    private underlyingPrice: number = 0;
    private shouldExpandEarliestExpiration: boolean = true;
    private isNbbo: boolean = false;
    private dictionary: Dictionary | null = null;

    private currencyFormat?: NumberFormat;
    private priceFormat?: NumberFormat;

    private readonly underlyingFieldInfo: UnderlyingFieldInfo = {};
    private readonly underlyingFieldIds: FieldId[];
    private readonly optionFieldIds: FieldId[];

    // props.
    private datasourceid: DataSourceId = DataSourceId.activ;
    private symbol: string = "";
    private relationshipId: string = "nbboOption";
    private conflationtype: number = ConflationType.none;
    private conflationinterval: number = 100;

    // Used by stats.js in website.
    subscribeTimestamp: number = 0;
    initialResponseTimestamp: number = 0;
    renderingCompleteTimestamp: number = 0;
    responsesReturned: number = 0;
    totalUpdates: number = 0;

    static props = {
        datasourceid: props.number,
        symbol: props.string,
        relationshipId: props.string,
        conflationtype: props.number,
        conflationinterval: props.number
    };

    constructor() {
        super();

        const element = document.createElement("div");
        element.className = "activ-one-api-webcomponent option-chain";
        element.innerHTML = `<style>${commonCss}${indexCss}</style>${indexHtml}`;

        this.renderRoot.appendChild(element);
        this.rootElement = element;

        // TODO: Watch for resizes so we can add/remove columns.

        this.options = element.querySelector(".option-chain-options") as HTMLDivElement;
        this.status = element.querySelector(".option-chain-status") as HTMLDivElement;
        this.overlay = element.querySelector(".option-chain-overlay") as HTMLDivElement;

        // Find all elements mapping to field ids in the underlying header and cache them.
        const underlyingFieldIds: FieldId[] = [FieldId.FID_CLOSE, FieldId.FID_CURRENCY];

        for (const node of Array.from(element.querySelectorAll(".option-chain-underlying-header [data-activ-field-id]"))) {
            const element = node as HTMLElement;
            const fieldId = FieldId[node.getAttribute("data-activ-field-id") as keyof typeof FieldId];
            underlyingFieldIds.push(fieldId);

            this.underlyingFieldInfo[fieldId] = {
                element,
                getTrend: getTrendHelperFromElement(fieldId, element)
            };
        }

        this.underlyingFieldIds = underlyingFieldIds;

        // Note close price is pointing at the same element as trade price.
        this.underlyingFieldInfo[FieldId.FID_CLOSE] = this.underlyingFieldInfo[FieldId.FID_TRADE];

        // Formatting for %change.
        this.underlyingFieldInfo[FieldId.FID_PERCENT_CHANGE]!.rationalNumberFormat = percentFormat;

        // Get list of field ids to request for options.
        const optionFieldIds: FieldId[] = [FieldId.FID_EXPIRATION_DATE, FieldId.FID_OPTION_TYPE];

        for (const optionElement of Array.from(
            element.querySelectorAll(".option-chain-call[data-activ-field-id], .option-chain-center-cells[data-activ-field-id]")
        )) {
            const fieldId = FieldId[optionElement.getAttribute("data-activ-field-id") as keyof typeof FieldId];
            optionFieldIds.push(fieldId);
        }

        this.optionFieldIds = optionFieldIds;

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

        // Tooltips for header fields.
        const headerFields = this.rootElement.querySelectorAll(
            ".option-chain-sub-header-cell[data-activ-field-id],.option-chain-underlying-header-cell[data-activ-field-id]"
        );
        for (const headerFieldElement of Array.from(headerFields)) {
            const fieldId = FieldId[headerFieldElement.getAttribute("data-activ-field-id") as keyof typeof FieldId];
            const fieldInfo = this.dictionary!.getFieldInfo(fieldId);
            if (fieldInfo != null) {
                (headerFieldElement as HTMLElement).title = fieldInfo.name;
            }
        }

        this.subscribe();

        try {
            await this.session.disconnected;
            this.setStatus("Disconnected");
        } catch (e) {
            this.setStatus(`Connection broken: ${e}`);
        } finally {
            this.unsubscribe();
            this.session = null;
        }
    }

    propsChangedCallback(next: any, prev: any) {
        this.subscribe();
    }

    private async subscribe() {
        this.unsubscribe();

        if (this.session == null || this.symbol === "") {
            return;
        }

        this.resetStats();
        this.shouldExpandEarliestExpiration = true;
        this.setStatus("Subscribing...");

        // Only need to show exchange column for all regional options. NBBO is implicitly "O".
        // Call processResize() for an initial adjustment based on whether the exchange column is present.
        this.isNbbo = this.relationshipId.startsWith("nbbo");
        (this.rootElement.querySelector("#option-chain-sub-header-cell-exchange") as HTMLElement).style.display = this.isNbbo
            ? "none"
            : "";
        this.processResize(this.rootElement);

        try {
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

            // Look up the company symbol.
            let companySymbol = null;

            const companyTopicIdHandle = this.session.query({
                dataSourceId: this.datasourceid,
                tagExpression: `symbol=${this.symbol} navigate=company`
            });
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
                    const name = companyMessage.fieldData.getField(FieldId.FID_NAME);
                    this.updateUnderlyingField(name);
                    this.underlyingFieldInfo[FieldId.FID_NAME]!.element.setAttribute("title", name.value as string);
                }
                companyMessage.delete();
            }

            // Set up underlying subscription.
            this.underlyingSubscription = this.session.subscribe(
                {
                    dataSourceId: this.datasourceid,
                    symbol: this.symbol
                },
                this.subscriptionParametersHandle == null ? undefined : this.subscriptionParametersHandle
            );

            // Process the subscription to the underlying.
            this.processUnderlying(this.underlyingSubscription!);

            // Search for the options.
            const optionTopicHandle = this.session.query({
                dataSourceId: this.datasourceid,
                tagExpression: `symbol=${this.symbol} navigate=${this.relationshipId}`
            });

            let hasInitialOptionResults = false;
            let topicQueryResult = await optionTopicHandle.next();
            while (!hasInitialOptionResults && topicQueryResult.done !== true) {
                const result = topicQueryResult.value as TopicQueryResult;
                if (result.statusCode != StatusCode.success) {
                    this.setStatus(`Error fetching options: ${StatusCode[result.statusCode]}`);
                    continue;
                }

                if (undefined == result.message) {
                    // If status code was success and the message is empty then the initial set of results is complete.
                    hasInitialOptionResults = true;
                } else {
                    // Add a new subscription if needed.
                    let option: OptionSubscription | undefined = this.optionSubscriptions.get(result.message.topicId.symbol);
                    if (undefined === option && !result.message.isRemove) {
                        this.addOptionSubscription(result.message.topicId);
                    }
                }

                topicQueryResult = await optionTopicHandle.next();
            }
            if (!hasInitialOptionResults) throw new Error("problem fetching option results.");

            // Keep asynchronously watching the option topic query handle for adds and deletes.
            (async () => {
                for await (const result of optionTopicHandle) {
                    if (undefined !== result.message) {
                        let option: OptionSubscription | undefined = this.optionSubscriptions.get(result.message.topicId.symbol);
                        if (undefined === option && !result.message.isRemove) {
                            this.addOptionSubscription(result.message.topicId);
                        }

                        if (result.message.isRemove && undefined !== option) {
                            this.deleteOption(option);
                            this.optionSubscriptions.delete(result.message.topicId.symbol);
                        }
                    }
                }
            })();
        } catch (e) {
            this.setStatus(`Error subscribing: ${e}`);
        }
    }

    private unsubscribe() {
        this.options.innerHTML = "";

        this.optionSubscriptions.forEach((option) => {
            option.subscriptionHandle.delete();
        });
        this.optionSubscriptions.clear();

        if (this.underlyingSubscription != null) {
            this.underlyingSubscription.delete();
            this.underlyingSubscription = null;
        }
        if (this.subscriptionParametersHandle != null) {
            this.subscriptionParametersHandle.delete();
            this.subscriptionParametersHandle = null;
        }

        this.optionChainData = [];
        this.underlyingPrice = 0;
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

    private async processUnderlying(handle: SubscriptionHandle) {
        const firstResult = await handle.next();
        const result = firstResult.value as SubscriptionResult;

        if (StatusCode.success != result.statusCode || result.message === undefined) {
            this.setStatus("Failed to fetch underlying");
            if (undefined !== result.message) result.message.delete();

            // this.unsubscribe();
            throw new Error("Failed to fetch underlying");
        }

        if (0 == this.responsesReturned) {
            this.setStatus(null);
            this.initialResponseTimestamp = performance.now();
        }
        ++this.responsesReturned;

        (this.rootElement.querySelector("#option-chain-underlying-header-symbol") as HTMLElement).textContent =
            result.message.symbol;

        this.underlyingFieldInfo[FieldId.FID_EXCHANGE]!.element.textContent = await getExchangeName(
            getExchangeCode(result.message.symbol),
            this.session!
        );

        if (result.message!.fieldData.isFieldPresent(FieldId.FID_CURRENCY)) {
            const currencyField = result.message!.fieldData.getField(FieldId.FID_CURRENCY);
            if (currencyField.value != null) {
                const currencyFormat = new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: currencyField.value as string,
                    // For sub-penny, etc., regardless of default for currency.
                    maximumFractionDigits: 9
                });
                this.currencyFormat = currencyFormat;

                this.priceFormat = new Intl.NumberFormat(undefined, {
                    // Not setting "style" here to avoid displaying currency symbol.
                    // We'll only use currencyFormat in the underlying header to show currency info.
                    currency: currencyField.value as string,
                    // Without "style: currency", we don't get minimumFractionDigits so copy from currencyFormat.
                    minimumFractionDigits: currencyFormat.resolvedOptions().minimumFractionDigits,
                    // For sub-penny, etc., regardless of default for currency.
                    maximumFractionDigits: 9
                });
            }
        }

        // Use currencyFormat for the trade price in the underlying header. It will show the currency.
        for (const fieldId of [FieldId.FID_TRADE, FieldId.FID_CLOSE]) {
            const underlyingField = this.underlyingFieldInfo[fieldId];
            if (underlyingField != null) {
                underlyingField.rationalNumberFormat = this.currencyFormat;
            }
        }

        this.updateUnderlying(result.message.fieldData);

        // Special case if closed; updateUnderlying() ignores FID_CLOSE.
        if (this.underlyingPrice === 0 && result.message.fieldData.isFieldPresent(FieldId.FID_CLOSE)) {
            const field = result.message.fieldData.getField(FieldId.FID_CLOSE);
            if (field.value != null) {
                this.underlyingPrice = (field.value as TRational).valueOf();
                this.updateUnderlyingField(field);

                // On the off chance options arrived before the underlying:
                this.updateInTheMoneyOptions(0);
            }
        }

        // Set up the handling of the rest of the updates.
        (async () => {
            for await (const result of handle) {
                if (result.statusCode == StatusCode.success && result.message !== undefined) {
                    ++this.totalUpdates;

                    const previousUnderlyingPrice = this.underlyingPrice;
                    this.updateUnderlying(result.message.fieldData);

                    if (previousUnderlyingPrice != this.underlyingPrice) {
                        this.updateInTheMoneyOptions(previousUnderlyingPrice);
                    }
                }
            }
        })();
    }

    private updateUnderlying(fieldData: FieldData) {
        for (const field of fieldData) {
            if (!field.doesUpdateLastValue) {
                continue;
            }

            switch (field.id) {
                case FieldId.FID_TRADE:
                    if (field.value != null) {
                        this.underlyingPrice = (field.value as TRational).valueOf();
                        this.updateUnderlyingField(field);
                    }
                    break;

                case FieldId.FID_CLOSE:
                    // Ignore FID_CLOSE; we'll only use it on initial load if out of hours and FID_TRADE isn't defined.
                    break;

                default:
                    this.updateUnderlyingField(field);
                    break;
            }
        }
    }

    private updateUnderlyingField(field: Field) {
        const fieldInfo = this.underlyingFieldInfo[field.id as FieldId];
        if (fieldInfo != null) {
            if (field.type === FieldType.tRational) {
                applyTrendStyle(fieldInfo.getTrend(field.value as TRational), fieldInfo.element);
            } else if (field.value == null) {
                clearTrendStyle(fieldInfo.element);
            }

            fieldInfo.element.textContent = formatField(field, fieldInfo);
        }
    }

    private async processOption(option: OptionSubscription, record: SubscriptionMessage) {
        ++this.responsesReturned;

        if (!record.fieldData.isFieldPresent(FieldId.FID_OPTION_TYPE)) {
            console.warn(`Dropping option ${record.symbol} with missing option type`);
            return;
        }
        if (!record.fieldData.isFieldPresent(FieldId.FID_EXPIRATION_DATE)) {
            console.warn(`Dropping option ${record.symbol} with missing expiration date`);
            return;
        }
        if (!record.fieldData.isFieldPresent(FieldId.FID_STRIKE_PRICE)) {
            console.warn(`Dropping option ${record.symbol} with missing strike price`);
            return;
        }

        const optionType = record.fieldData.getField(FieldId.FID_OPTION_TYPE);
        const isCall = optionType.value === "C";
        if (!isCall && optionType.value !== "P") {
            console.warn(`Dropping option ${record.symbol} with unknown option type ${optionType.value}`);
            return;
        }

        const expirationDateField = record.fieldData.getField(FieldId.FID_EXPIRATION_DATE);
        if (expirationDateField.value == null) {
            console.warn(`Dropping option ${record.symbol} with undefined expiration date`);
            return;
        }
        const strikePriceField = record.fieldData.getField(FieldId.FID_STRIKE_PRICE);
        if (strikePriceField.value == null) {
            console.warn(`Dropping option ${record.symbol} with undefined strike price`);
            return;
        }

        option.expirationSection = this.createOrFindExpirySection(expirationDateField.value as Date);
        option.row = await this.createOrFindOptionRow(record.symbol, option.expirationSection, strikePriceField);
        option.updateOption = isCall ? option.row.updateCallOption : option.row.updatePutOption;

        // Set tooltip to symbol.
        for (const node of Array.from(
            option.expirationSection.element.querySelectorAll(`.${OptionChain.getSideClass(isCall)}[data-activ-field-id]`)
        )) {
            const element = node as HTMLElement;

            // Tooltip for the symbol.
            element.title = record.symbol;
        }

        option.updateOption(record);
        option.row.updateInTheMoney(null, this.underlyingPrice);
    }

    private createOrFindExpirySection(expirationDate: Date): ExpirationSection {
        const index = this.optionChainData.findIndex((section) => section.expirationDate >= expirationDate);
        if (index !== -1) {
            const expirationSection = this.optionChainData[index];
            if (expirationSection.expirationDate.valueOf() === expirationDate.valueOf()) {
                return expirationSection;
            }
        }

        const expirationSection = this.createExpirySection(expirationDate);

        if (this.shouldExpandEarliestExpiration) {
            // If we're loading the page, keep the top expiry section expanded and the others collapsed.
            if (this.optionChainData.length === 0 || index === 0) {
                // Whilst loading, only keep the earliest expiry section expanded.
                for (const expirationSection of this.optionChainData) {
                    this.toggleExpirationSection(expirationSection, false);
                }

                this.toggleExpirationSection(expirationSection, true);
            }
        }

        if (index === -1) {
            this.options.appendChild(expirationSection.element);
            this.optionChainData.push(expirationSection);
        } else {
            this.options.insertBefore(expirationSection.element, this.optionChainData[index].element);
            this.optionChainData.splice(index, 0, expirationSection);
        }

        return expirationSection;
    }

    private async createOrFindOptionRow(
        symbol: string,
        expirationSection: ExpirationSection,
        strikePriceField: Field
    ): Promise<OptionRow> {
        // Key for an option in an expiry date section is strike+root+exchange.
        const root = symbol.slice(0, symbol.indexOf(SymbolSeparator.expirationDateSeparator));
        const exchangeCode = getExchangeCode(symbol);
        const strikePrice = strikePriceField.value as number;

        const index = expirationSection.optionRows.findIndex((row) => {
            if (row.strikePrice > strikePrice) {
                return true;
            } else if (row.strikePrice < strikePrice) {
                return false;
            }

            if (row.root > root) {
                return true;
            } else if (row.root < root) {
                return false;
            }

            return row.exchangeCode >= exchangeCode;
        });

        if (index !== -1) {
            const existingRow = expirationSection.optionRows[index];

            if (
                existingRow.strikePrice.valueOf() === strikePrice.valueOf() &&
                existingRow.root === root &&
                existingRow.exchangeCode === exchangeCode
            ) {
                return existingRow;
            }
        }

        const row = await this.createOptionRow(strikePriceField, root, exchangeCode);

        if (index === -1) {
            expirationSection.optionRowsElement.appendChild(row.element);
            expirationSection.optionRows.push(row);
        } else {
            expirationSection.optionRowsElement.insertBefore(row.element, expirationSection.optionRows[index].element);
            expirationSection.optionRows.splice(index, 0, row);
        }

        if (this.shouldExpandEarliestExpiration) {
            // On initial load, scroll to the at-the-money options. scrollIntoView() causes issues with Edge.
            OptionChain.scrollToAtTheMoney(expirationSection);
        }

        return row;
    }

    private createExpirySection(expirationDate: Date): ExpirationSection {
        // Main expiry div contains the header row (with the date, that is clickable)
        // and a div containing all the option divs themselves.
        const element = document.createElement("div");
        element.className = "option-chain-expiry-section";
        element.innerHTML = expirationSectionHtml;

        const headerElement = element.querySelector(".option-chain-expiry-row") as HTMLElement;
        headerElement.textContent = dateFormat.format(expirationDate);

        const optionRowsElement = document.createElement("div");
        optionRowsElement.className = "option-chain-option-rows";

        const expirationSection = { expirationDate, element, headerElement, optionRowsElement, optionRows: [] };

        // Clicking the expiry header toggles display of its options.
        headerElement.addEventListener("click", () => {
            // Disable auto-toggling of sections after a manual click (only used on initial load anyway).
            this.shouldExpandEarliestExpiration = false;

            this.toggleExpirationSection(expirationSection);
        });

        return expirationSection;
    }

    private toggleExpirationSection(expirationSection: ExpirationSection, show?: boolean) {
        const expandedClass = "option-chain-expiry-row-expanded";
        const isExpanded = expirationSection.element.contains(expirationSection.optionRowsElement);

        if (show == null || show !== isExpanded) {
            if (isExpanded) {
                expirationSection.element.removeChild(expirationSection.optionRowsElement);
                expirationSection.headerElement.classList.remove(expandedClass);
            } else {
                expirationSection.element.appendChild(expirationSection.optionRowsElement);
                expirationSection.headerElement.classList.add(expandedClass);

                OptionChain.scrollToAtTheMoney(expirationSection);
            }
        }
    }

    private static scrollToAtTheMoney(expirationSection: ExpirationSection) {
        // Scroll first above the money in to view.
        const aboveTheMoneyRow = expirationSection.optionRowsElement.querySelector(".option-chain-above-the-money");
        if (aboveTheMoneyRow != null) {
            aboveTheMoneyRow.scrollIntoView({ block: "center" });
        }
    }

    private async createOptionRow(strikePriceField: Field, root: string, exchangeCode: string): Promise<OptionRow> {
        const rowElement = document.createElement("div");
        rowElement.className = "option-chain-option-row";
        rowElement.innerHTML = optionRowHtml;

        const strikePrice = strikePriceField.value as number;
        const strikePriceCell = rowElement.querySelector(`[data-activ-field-id="FID_STRIKE_PRICE"]`) as HTMLDivElement;
        strikePriceCell.textContent = formatField(strikePriceField, { rationalNumberFormat: this.priceFormat });

        const exchangeCodeCell = rowElement.querySelector(`[data-activ-field-id="FID_EXCHANGE"]`) as HTMLDivElement;
        exchangeCodeCell.textContent = exchangeCode;
        exchangeCodeCell.style.display = this.isNbbo ? "none" : "";
        exchangeCodeCell.title = await getExchangeName(exchangeCode, this.session!);

        let callFieldInfos: FieldInfo[] = [];
        let putFieldInfos: FieldInfo[] = [];

        const buildSide = (isCall: boolean) => {
            const fieldInfos = isCall ? callFieldInfos : putFieldInfos;

            for (const node of Array.from(
                rowElement.querySelectorAll(`.${OptionChain.getSideClass(isCall)}[data-activ-field-id]`)
            )) {
                const element = node as HTMLElement;
                const fieldId = FieldId[node.getAttribute("data-activ-field-id") as keyof typeof FieldId];

                fieldInfos[fieldId] = {
                    element,
                    // Use priceFormat if a price field.
                    rationalNumberFormat: node.classList.contains("option-chain-price-field") ? this.priceFormat : undefined,
                    getTrend: getTrendHelperFromElement(fieldId, element)
                };
            }
        };

        buildSide(true);
        buildSide(false);

        // Initial sizing of row.
        this.processResize(rowElement);

        function makeUpdateOption(fieldInfos: FieldInfo[]) {
            return function(image: SubscriptionMessage) {
                for (const field of image.fieldData) {
                    if (!field.doesUpdateLastValue) {
                        continue;
                    }

                    // TODO closing.
                    const fieldInfo = fieldInfos[field.id];

                    if (fieldInfo != null) {
                        if (field.type === FieldType.tRational) {
                            applyTrendStyle(fieldInfo.getTrend(field.value as TRational), fieldInfo.element);
                        } else if (field.value == null) {
                            clearTrendStyle(fieldInfo.element);
                        }

                        fieldInfo.element.textContent = formatField(field, fieldInfo);
                    }
                }
            };
        }

        function updateInTheMoney(previousUnderlyingPrice: number | null, underlyingPrice: number) {
            if ((previousUnderlyingPrice == null || strikePrice <= previousUnderlyingPrice) && strikePrice > underlyingPrice) {
                rowElement.classList.add("option-chain-above-the-money");
                rowElement.classList.remove("option-chain-below-the-money");
            } else if (
                (previousUnderlyingPrice == null || strikePrice >= previousUnderlyingPrice) &&
                strikePrice < underlyingPrice
            ) {
                rowElement.classList.remove("option-chain-above-the-money");
                rowElement.classList.add("option-chain-below-the-money");
            }
        }

        return {
            strikePrice,
            root,
            exchangeCode,
            element: rowElement,
            updateCallOption: makeUpdateOption(callFieldInfos),
            updatePutOption: makeUpdateOption(putFieldInfos),
            updateInTheMoney
        };
    }

    private addOptionSubscription(topicId: TopicId) {
        // Initiate the async subscription.
        const option = {
            subscriptionHandle: this.session!.subscribe(
                topicId,
                this.subscriptionParametersHandle == null ? undefined : this.subscriptionParametersHandle
            )
        } as OptionSubscription;
        this.optionSubscriptions.set(topicId.symbol, option);

        (async () => {
            // Asynchronously iterate all records resulting from the request.
            for await (const result of option.subscriptionHandle) {
                if (0 == this.responsesReturned) {
                    this.setStatus(null);
                    this.initialResponseTimestamp = performance.now();
                }

                if (result.statusCode == StatusCode.success && result.message !== undefined) {
                    if (undefined === option.updateOption) {
                        // Process initial refresh.
                        await this.processOption(option, result.message);
                    } else {
                        // If we have an update function defined this much be an update.
                        ++this.totalUpdates;
                        option.updateOption(result.message);
                    }
                } else {
                    console.warn(`Dropping option ${topicId.symbol} with status ${result.statusCode}`);
                }
            }
        })();

        // If we have received a response for every option + 1 for the underlying then we have completed the initial snapshot.
        if (this.optionSubscriptions.size + 1 == this.responsesReturned) {
            this.shouldExpandEarliestExpiration = false;
            this.renderingCompleteTimestamp = performance.now();
        }
    }

    private deleteOption(option: OptionSubscription) {
        if (null == option.expirationSection) return;

        if (null == option.row) return;

        const optionIndex = option.expirationSection.optionRows.indexOf(option.row);
        if (optionIndex === -1) {
            return;
        }

        option.expirationSection.optionRowsElement.removeChild(option.row.element);
        option.expirationSection.optionRows.splice(optionIndex, 1);

        // Whole expiration might now be empty.
        if (option.expirationSection.optionRows.length > 0) {
            return;
        }

        const expirationIndex = this.optionChainData.indexOf(option.expirationSection);
        if (expirationIndex === -1) {
            return;
        }

        this.options.removeChild(option.expirationSection.element);
        this.optionChainData.splice(expirationIndex, 1);

        // Note we're deleting the entire row when the put or call is deleted; updates to the other side will
        // be ignored. Both should be deleted at the same time, anyway.
    }

    private updateInTheMoneyOptions(previousUnderlyingPrice: number) {
        for (const section of this.optionChainData) {
            for (const row of section.optionRows) {
                row.updateInTheMoney(previousUnderlyingPrice, this.underlyingPrice);
            }
        }
    }

    private setStatus(message: string | null) {
        this.status.textContent = message;
        this.overlay.style.display = message == null ? "none" : "";
    }

    /**
     * Size the elements in the option display based on our container size.
     *
     * Note we're not using `@media` max-width CSS rules as we want to be dependent on the size of the
     * WebComponent rather than the display.
     *
     * @param parentNode - parent node of elements to size. this.rootElement for whole document (on resize) or
     *        an option row for initial draw of that row.
     */
    private processResize(parentNode: ParentNode) {
        // TODO it would be nice to bin the column width calc. flexbox almost works, but dynamically adding
        // padding to elements based on trending (for arrows) causes columns to misalign. I'm sure there's a solution...

        const smallWidth = 540;
        const mediumWidth = 900;
        const currentWidth = this.rootElement.clientWidth;

        // Get the 3 sets of cells for styling.
        const allCells = Array.from(parentNode.querySelectorAll(".option-chain-sub-header-cell, .option-chain-option-cell"));
        const mediumCells = Array.from(parentNode.querySelectorAll(".option-chain-medium"));
        const smallCells = Array.from(parentNode.querySelectorAll(".option-chain-small"));

        // Use the header row to get the number of columns for the 3 size cases.
        const optionsSubHeader = this.rootElement.querySelector(".option-chain-sub-header-row") as HTMLElement;
        const allColumnsCount = optionsSubHeader.querySelectorAll(".option-chain-sub-header-cell").length - (this.isNbbo ? 1 : 0);
        const mediumColumnsCount = allColumnsCount - optionsSubHeader.querySelectorAll(".option-chain-medium").length;
        const smallColumnsCount = mediumColumnsCount - optionsSubHeader.querySelectorAll(".option-chain-small").length;

        function handleColumnCount(columnCount: number) {
            const width = `calc((100% - (${columnCount} - 1) * 0.1%) / ${columnCount})`;

            for (const cell of allCells) {
                (cell as HTMLElement).style.width = width;
            }

            const isSmallHidden = columnCount <= smallColumnsCount;
            const isMediumHidden = columnCount <= mediumColumnsCount;

            for (const cell of mediumCells) {
                (cell as HTMLElement).style.display = isMediumHidden ? "none" : "";
            }

            for (const cell of smallCells) {
                (cell as HTMLElement).style.display = isSmallHidden ? "none" : "";
            }
        }

        if (currentWidth < smallWidth) {
            handleColumnCount(smallColumnsCount);
        } else if (currentWidth < mediumWidth) {
            handleColumnCount(mediumColumnsCount);
        } else {
            handleColumnCount(allColumnsCount);
        }
    }

    private static getSideClass(isCall: boolean) {
        return `option-chain-${isCall ? "call" : "put"}`;
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

window.customElements.define("option-chain", OptionChain);

export { Attributes };
export default OptionChain;
