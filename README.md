# one-api-examples

Examples using the ACTIV Financial ContentGateway Web API.

## Prerequisites

The API uses [WebAssembly](https://webassembly.org/) and as such requires quite recent versions of JavaScript run-times.

#### Browser versions

* Firefox 54 or higher.
* Chrome 61 or higher.
* Edge 40.15063.0.0 (Windows 10 Creators Update) or higher. You may need to <b>enable experimental JavaScript features</b> in <a href=about:flags>about:flags</a> for versions prior to Windows 10 Fall Creators Update.
* Safari 11 or higher.

#### Node version

8 or higher.

#### OpenFin version

9 or higher.

## Building the examples from the repository sources

* `yarn` is assumed to be available in your path. Install either with your package manager (e.g. `sudo dnf install nodejs-yarn` for Fedora), or from [here](https://yarnpkg.com/).
* Clone this repository somewhere.
* From the root directory of the repository clone, `yarn install`: install dependencies and cross-link packages (in `packages/*`).
* `yarn develop`: build each package (equivalent to `yarn develop` in each package, but taking care of any ordering dependencies) with webpack development mode.
* Alternatively, `yarn build`: build using webpack production mode.
* To make locally built packages available in preference to globally published versions, run `yarn yarn:publish-links`. To remove the links, run `yarn yarn:unpublish-links`.
* To use locally built versions of dependencies (specifically, `one-api`), rather than globally published versions, run `yarn yarn:use-links`. To remove the links, run `yarn yarn:disuse-links`. Note at this time, the `one-api` itself is hosted in a private repository.

### Visual Studio Code

The repository has various pre-configured tasks and debug launch configurations for [Visual Studio Code](https://code.visualstudio.com/).

Note: the default build task runs `yarn develop` at the top level.

## Types of run-times

Examples for various run-times are available. See the appropriate README for more information:

* [Browser](packages/browser/)

## Programming with the API

To see how the API can be used, read our [getting started](https://weboneapi.activfinancial.com/tutorials/) tutorial.

[![lerna](https://img.shields.io/badge/maintained%20with-lerna-cc00ff.svg)](https://lernajs.io/)
