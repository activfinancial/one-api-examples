/*
 * Various utilities.
 */

import { DataSourceId, FieldId, Session } from "@activfinancial/one-api";

/** Awaitable function to wait for DOMContentLoaded on a document. */
export function domReady(document: Document) {
    return new Promise<void>((resolve) => {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => resolve());
        } else {
            resolve();
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** Running in OpenFin? */
// HACK don't want a dependency on OpenFin types just to check if there's a "fin" global.
export const isOpenFin = typeof window !== "undefined" && (window as any).fin;

// ---------------------------------------------------------------------------------------------------------------------------------

// Don't seem to get beforeunload with OpenFin, so use unload.
const unloadEventType = isOpenFin ? "unload" : "beforeunload";

/** Generically add an unload handler to the window. */
export function addUnloadHandler(handler: any) {
    return window.addEventListener(unloadEventType, handler);
}

let exchangeNameMap = new Map<string, string>();
const US_COMPOSITE_EXCHANGE = "US";

/** Get the exchange name from the exchange code. */
export async function getExchangeName(exchangeCode: string, session: Session) {
    // HACK we can't have an empty exchange code so use "US" as the exchange code for composite exchanges.
    if (exchangeCode == "") exchangeCode = US_COMPOSITE_EXCHANGE;

    if (exchangeNameMap.has(exchangeCode)) return exchangeNameMap.get(exchangeCode)!;

    let result = await session.snapshot({
        dataSourceId: DataSourceId.activ,
        symbol: exchangeCode
    });

    if (!result.fieldData.isFieldPresent(FieldId.FID_NAME))
        throw new Error(`FID_NAME could not be found for exchange with code ${exchangeCode}`);

    const name = result.fieldData.getField(FieldId.FID_NAME).value!.toString();
    exchangeNameMap.set(exchangeCode, name);

    result.delete();

    return name;
}
