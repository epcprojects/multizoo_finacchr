const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  entry: { main: './src/main.ts' },
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    filename: '[name].js',
    clean: true,
    libraryTarget: 'commonjs2',
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  target: 'node',
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  externalsPresets: { node: true },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      // Bundle the shared libs (@multizoo/interfaces|types|utils) from
      // source instead of treating them as externals that need their own
      // `nx build` output in dist/libs — one less moving part for local dev.
      buildLibsFromSource: true,
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
      fileReplacements:
        process.env.NODE_ENV === 'production'
          ? [
              {
                replace: 'apps/api/environments/environment.ts',
                with: 'apps/api/environments/environment.prod.ts',
              },
            ]
          : [],
    }),
  ],
};
