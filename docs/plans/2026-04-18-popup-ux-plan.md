# Popup UX Upgrade Plan

## Goal

Reduce friction in the popup by making page readiness explicit and actionable, and by moving frequent provider/language controls into the popup.

## Improvements

1. Detect whether the active tab is supported and whether the content script is reachable.
2. Show a clear banner in the popup when the current page is unsupported or needs refresh.
3. Add one-click recovery actions in the popup for retrying detection or refreshing the page.
4. Add compact provider and target-language controls directly in the popup so users can switch common settings without leaving the current page.
5. Keep translation actions disabled only when there is a real blocker: missing configuration or an unusable page.

## Success Criteria

- Popup clearly distinguishes between unsupported pages and refresh-needed pages.
- Users can refresh or retry from the popup without guessing.
- Users can change provider and target language directly in the popup.
- Popup interaction remains buildable, lint-clean, and test-covered for the new state logic.
