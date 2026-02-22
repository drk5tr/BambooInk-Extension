const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");


module.exports = (env, argv) => {
  const isDev = argv.mode === "development";

  return {
    entry: {
      "service-worker": "./src/background/service-worker.ts",
      "shadow-hook": "./src/content/shadow-hook.ts",
      "content-script": "./src/content/content-script.ts",
      popup: "./src/popup/popup.tsx",
      options: "./src/options/options.tsx",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
      fallback: { fs: false, path: false },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, "css-loader", "postcss-loader"],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: "[name].css" }),
      new CopyPlugin({
        patterns: [
          { from: "public", to: "." },
        ],
      }),
    ],
    devtool: isDev ? "inline-source-map" : false,
    optimization: {
      minimize: !isDev,
    },
  };
};
