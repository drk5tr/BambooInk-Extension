const path = require("path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

// Load .env file
require("dotenv").config();

module.exports = (env, argv) => {
  const isDev = argv.mode === "development";

  return {
    entry: {
      "service-worker": "./src/background/service-worker.ts",
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
      new webpack.DefinePlugin({
        BAMBOOINK_API_KEY: JSON.stringify(process.env.BAMBOOINK_API_KEY || ""),
      }),
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
