# Auto Translate Mode Plan

## Goal

Turn the existing `enabled` configuration into a real product capability: users can enable auto translate from the popup, and supported pages will automatically start translation after page load or navigation.

## Scope

- Add a popup toggle for automatic translation mode.
- Make the toggle persist through the existing config store.
- Start translation automatically when a supported tab finishes loading and the mode is enabled.
- Re-trigger auto translation when a content script reports `READY`.
- Keep manual controls working unchanged.

## Success Criteria

- Users can turn auto translate on and off from the popup.
- Enabling auto translate starts translation on the current page when possible.
- Reloading or navigating to a new supported page auto-starts translation when enabled.
- Disabling auto translate stops active translation overlays/tasks across tabs.
