/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "NimboWidgets",
  displayName: "Nimbo",
  // Interactive widgets and Live Activity buttons need iOS 17.
  deploymentTarget: "17.0",
  colors: {
    $accent: "#64d2ff",
    $widgetBackground: "#000000",
  },
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
