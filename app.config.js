module.exports = ({ config }) => {
  if (process.platform !== 'win32') return config;

  return {
    ...config,
    plugins: config.plugins.map((plugin) => {
      if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') return plugin;
      return [plugin[0], {
        ...plugin[1],
        android: { ...plugin[1].android, cmakeVersion: '3.31.6' },
      }];
    }),
  };
};
