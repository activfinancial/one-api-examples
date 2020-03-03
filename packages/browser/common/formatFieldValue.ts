/*
 * Field formatting helpers shared across samples for consistent display.
 */

import { Field, FieldId, FieldType, Rational, TRational, Trend, TrendType } from "@activfinancial/one-api";

import { sprintf } from "sprintf-js";
import { TextDecoder } from "text-encoding";

import trendUpArrow from "!raw-loader!./trendUpArrow.svg";
import trendDownArrow from "!raw-loader!./trendDownArrow.svg";

const uriEncodedTrendUpArrow = encodeURIComponent(trendUpArrow);
const uriEncodedTrendDownArrow = encodeURIComponent(trendDownArrow);

// ---------------------------------------------------------------------------------------------------------------------------------

const textDecoder = new TextDecoder("ascii", { fatal: true });

/** Pretty up a Uint8Array field with ASCII and hex dump. */
function formatUint8Array(value: Uint8Array) {
    let isPrintable = true;

    const hex = [...value]
        .map((chr) => {
            // HACK can't find a 7-bit encoding type and Chrome won't error in TextDecoder like Firefox so ends up printing garbage.
            if (chr < 32 || chr >= 127) {
                isPrintable = false;
            }

            return sprintf("%02x", chr);
        })
        .join(" ");

    try {
        if (isPrintable) {
            return `"${textDecoder.decode(value)}" (hex: ${hex})`;
        }
    } catch {}

    return `hex: ${hex}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------

const rationalNumberFormat = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 9
});

// ---------------------------------------------------------------------------------------------------------------------------------

/** Relaxed Intl.NumberFormat interface we can override. */
export interface NumberFormat {
    format(value: number): string;
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** Options for formatField(). */
export interface FormatFieldOptions {
    /** Text to show for undefined fields. Default is an empty string. */
    undefinedText?: string;

    /** Whether TRational fields should show trending info. Default is no. */
    showTrending?: boolean;

    /** Formatter for rational numbers. */
    rationalNumberFormat?: NumberFormat;
}

/** Format up a Field's value (that may be null) as a string. */
export function formatField(field: Field, options: FormatFieldOptions = {}): string {
    const thisRationalNumberFormat = options.rationalNumberFormat || rationalNumberFormat;

    if (!field.isDefined) return options.undefinedText || "";

    switch (field.type) {
        case FieldType.tRational:
            if (options.showTrending) {
                return `${thisRationalNumberFormat.format(
                    (field.value as TRational).valueOf()
                )} ${(field.value as TRational).trendingToString()}`;
            }

        // NB fall-through.

        case FieldType.rational:
            return thisRationalNumberFormat.format((field.value as Rational).valueOf());

        case FieldType.uInt:
        case FieldType.sInt:
        case FieldType.date:
        case FieldType.time:
        case FieldType.dateTime:
            return field.value!.toLocaleString();

        case FieldType.binaryArray:
        case FieldType.binaryString:
        case FieldType.blob:
        case FieldType.crcBlob:
            return formatUint8Array(field.value as Uint8Array);

        case FieldType.textArray:
        case FieldType.textString:
            return field.value as string;

        case FieldType.boolean:
            return field.value!.toString();

        default:
            break;
    }

    // NB never reached.
    return String(field.value!);
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** Add trend up/down arrow to an element. */
export function applyTrendStyle(trend: Trend, element: HTMLElement) {
    const anyElement: any = element;

    if (anyElement.activTRationalTrend == null) {
        // Initial call for this element.
        if (element.style.paddingLeft === "") {
            element.style.paddingLeft = "1rem";
        }
    } else if (anyElement.activTRationalTrend === trend) {
        // No need to touch trend styling.
        return;
    }

    anyElement.activTRationalTrend = trend;

    switch (trend) {
        case Trend.up:
            element.style.backgroundImage = `url('data:image/svg+xml,${uriEncodedTrendUpArrow}')`;
            element.style.color = "var(--shadow-trend-up-color)";
            break;

        case Trend.down:
            element.style.backgroundImage = `url('data:image/svg+xml,${uriEncodedTrendDownArrow}')`;
            element.style.color = "var(--shadow-trend-down-color)";
            break;

        default:
            element.style.backgroundImage = "";
            element.style.color = "";
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** Clear any trending from an element. */
export function clearTrendStyle(element: HTMLElement) {
    const anyElement: any = element;

    if (anyElement.activTRationalTrend != null) {
        delete anyElement.activTRationalTrend;

        anyElement.style.backgroundImage = "";
        anyElement.style.color = "";
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** Function that takes a TRational and returns a Trend. */
export interface TrendHelper {
    (value: TRational): Trend;
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** Get a Trend value based on a TRational's value. E.g. for fields such as FID_NET_CHANGE. */
export function getValueTrend(value: TRational) {
    if (value.numerator > 0) {
        return Trend.up;
    } else if (value.numerator < 0) {
        return Trend.down;
    } else {
        return Trend.unchanged;
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Get a function to extract a particular trend type from a TRational based on "data-activ-trend-type" attribute on an element.
 * Default to "tick" if attribute is not defined.
 */
export function getTrendHelperFromElement(fieldId: FieldId, element: HTMLElement): TrendHelper {
    // Override default "tick" trending for a field?
    const trendTypeStr = element.getAttribute("data-activ-trend-type");
    if (trendTypeStr != null) {
        return getTrendHelperFromString(fieldId, trendTypeStr);
    } else {
        return (value: TRational) => value.trends.tick;
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Get a function to extract a particular trend type from a TRational based on a string TrendType or "value" to
 * trend on an actual value.
 */
export function getTrendHelperFromString(fieldId: FieldId, trendTypeStr: string): TrendHelper {
    const trendType = trendTypeStr as keyof typeof TrendType;
    if (TrendType[trendType] != null) {
        return (value: TRational) => value.trends[trendType];
    } else if (trendTypeStr === "value") {
        return getValueTrend;
    } else {
        throw Error(`Invalid trend type ${trendTypeStr} for field ${fieldId}`);
    }
}
