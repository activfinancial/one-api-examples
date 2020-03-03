/*
 * Various utilities.
 */

/** Awaitable function to wait for DOMContentLoaded on a document. */
export function domReady(document: Document) {
    return new Promise((resolve) => {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", resolve);
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
