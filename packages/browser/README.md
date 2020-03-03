Examples here are for running in a browser environment.

### montage-viewer / oneapi-record-viewer / orderbook-viewer

These examples do not provide a UI for entering ACTIV feed credentials; you can edit the values in `packages/examples/browser/*/index.html` as appropriate.

Alternatively, the API code will lookup in `window.localStorage` for `ACTIV_SESSION_USER_ID` and `ACTIV_SESSION_PASSWORD`. There's no code in the API or examples to set values for those keys, so you could use the debugger console with the page open to set a value. E.g.:
```
localStorage.setItem("ACTIV_SESSION_USER_ID", "your-id");
localStorage.setItem("ACTIV_SESSION_PASSWORD", "your-password");
```
Then reload the page to have the API use these values. Note the hosted version of the samples at http://weboneapi.activfinancial.com/examples has a front end for entering credentials.

These examples are implemented using WebComponents. To run them in Firefox, the following may need to be set to `true` in `about:config`:

* `dom.webcomponents.shadowdom.enabled`
* `dom.webcomponents.customelements.enabled`

These should be enabled by default in Firefox 63.

#### Styling the example WebComponents

These samples all support the following CSS properties to allow some basic customization of the default styling:

* `--activ-foreground-color`: the main foreground color.
* `--activ-background-color`: the main background color.
* `--activ-header-background`: the CSS `background` property for header sections (e.g. underlying view in option-chain).
* `--activ-table-header-background-color`: the background color for table headers.
* `--activ-table-row-background-color`: the background color for table rows.
* `--activ-table-row-background-alt-color`: the alternative (every-other) background color for table rows.
* `--activ-table-row-background-hover-color`: the hover color for table rows.
* `--activ-input-background-color`: the background color for text input elements.
* `--activ-link-color`: the text color for hypertext links.
* `--activ-trend-up-color`: color for prices trending up.
* `--activ-trend-down-color`: color for prices trending down.
* `--activ-h1-color`: color for h1 elements; h1-h6 are supported.

#### record-viewer

record-viewer additionally supports:

* `--activ-record-viewer-field-name-color`: color for text in the field name column.
* `--activ-record-viewer-field-value-color`: color for text in the field value column.

### Visual Studio Code

Tasks:

* `serve-*`: equivalent to `yarn serve` for the corresponding browser example in `packages/examples/browser/` (serves on localhost port 8880).

Debug launch configurations:

* `Launch Chrome to *`: runs the `serve-*` task in the background and launches a Chrome debugging session to it.

The Chrome launch tasks assume the [Debugger for Chrome](https://marketplace.visualstudio.com/items?itemName=msjsdiag.debugger-for-chrome) extension is installed.

Note that the Chrome launch tasks set `"userDataDir": false` such that they will use your regular Chrome profile, rather than a temporary profile (in order that your settings and extensions are available). As a result, for Visual Studio Code to connect to the Chrome debugger, you should have no other instances of Chrome running before running the task.
