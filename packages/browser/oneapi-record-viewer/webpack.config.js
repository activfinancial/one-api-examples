const path = require("path");

const config = {
    entry: "./src/index.ts",
    output: {
        filename: "index.js",
        path: path.resolve(__dirname, "lib"),
        library: "activ_one_api_record_viewer",
        libraryTarget: "umd"
    },
    devtool: "source-map",
    resolve: {
        alias: {
            skatejs: "skatejs/esnext"
        },
        extensions: [".ts", ".js"],
        symlinks: false
    },
    externals: {
        "@activfinancial/one-api": {
            root: "activOneApi",
            commonjs: "@activfinancial/one-api",
            commonjs2: "@activfinancial/one-api",
            amd: "@activfinancial/one-api"
        }
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: "ts-loader",
                exclude: /node_modules/
            }
        ]
    },
    devServer: {
        // Note webpack-dev-server won't watch non-generated files for changes,
        // so to reload if e.g. the top level html is updated we need this config section.
        // publicPath is required even though it should be implicit from output.path.
        // Also, since switching to yarn workspaces, there are no local node_modules - they are
        // all at the root. So serve the root, too.
        port: 8880,
        static: [
            {
                directory: path.resolve(__dirname),
                watch: true
            },
            {
                directory: path.join(__dirname, "../../../../node_modules"),
                watch: true
            }
        ]
    }
};

module.exports = config;
