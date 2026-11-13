# Changelog

## 4.1.0

- Match sidebar directory separators to all four theme palettes with a subtle 1px solid line, including detached directories.
- Add Ordem Paranormal card/roll presentation for all four existing chat themes, including a padded roll-title band for merged messages.
- Add independent client OP card heading/body font settings; transfer old Interface card fonts once without overwriting explicit new values.
- Preserve native OP postprocessing during standalone HTML export and render-limiter history restoration through Foundry's compatibility dispatcher.
- Include OP styles/fonts in exported logs and give additional-CSS extensions separate style blocks for valid leading font imports.
- Keep sheets/dialogs, native rules/actions/permissions, plain narration and foreign structured payloads outside the adapter.
- Add font/migration/render-dispatch tests and document isolated browser/export verification and live-test limits.
