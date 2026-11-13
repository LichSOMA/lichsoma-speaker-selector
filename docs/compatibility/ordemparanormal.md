# Ordem Paranormal

Speaker Selector 4.1.0 adds a dedicated `ordemparanormal` adapter. It requires no Ordem Interface dependency and does not change system files, rolls, ownership, reactions, damage, or request commands.

## Ownership

- Speaker Selector owns chat card/roll presentation, heading/body fonts, generic speaker/portrait/merge presentation, history restoration and standalone HTML export.
- Ordem Interface 0.2.0 owns actor/threat/item sheets, their 650px default width, the independent sheet font, and system dialog themes.
- The native system owns every action, result, permission, hidden/disabled state and rule calculation. The adapter adds classes to original DOM nodes; it does not clone/replace buttons or attach action handlers.

Positive identification uses native card structure, non-empty OP flags, native roll classes, or core-shaped dice messages spoken by an OP agent/threat. The last family includes native unflagged threat/formula/untargeted/mixed damage rolls and indistinguishable actor `/r` messages. Generic rolls without an OP actor and foreign structured payloads stay under the existing generic presentation. No names, translated strings, die totals or secret flags are used to infer ownership. Unmarked narration/effect-expiration/description text remains plain chat.

## Fonts and themes

OP heading and body font menus are independent client settings. Body covers descriptions, tags, tables, buttons and dice results; icons and code keep their own font. Empty settings use the OP theme baseline, never the sheet, speaker, plain-chat or generic-dice font setting. Font CSS accepts `@font-face`, font-only `@import`, and a `.lichsoma-op-font-settings` profile with family/weight/style/variation settings. General CSS selectors are not injected.

On first use, stored client card fonts from Ordem Interface are transferred to the same roles only if the new setting has not been explicitly stored. This works without the old module being active. Existing new values, including an intentional empty value, are preserved. The transfer is marked complete once; there is no continuing inheritance or synchronization. Themes remain independent.

The four existing chat themes apply to OP payloads. Flavor titles remain in their original header, with a padded title band that remains readable when repeated speaker headers are merged. Native critical/success/failure distinctions and ritual element colors remain visible.

## Native rendering and export

Foundry 14.361 provides `ChatLog.renderMessage` to dispatch systems which still override `getHTML` rather than `renderHTML`. Export and render-limiter restoration now use that native dispatcher. They preserve OP's native success/failure and action postprocessing without manually invoking it twice. Older Foundry falls back to its available renderer.

Export includes the OP CSS and independent font CSS through the existing additional-CSS hook. Extension CSS receives a separate style block so a leading font `@import` remains valid. The final generic header/theme policy retains its prior order. Relative font URLs should be replaced with absolute URLs for logs opened away from the Foundry server.

## Validation and limits

- Node tests cover native rendering dispatch/export context, role-separated font CSS and one-time migration, existing module API and narrator protections.
- An isolated browser fixture uses the actual OP templates/postprocessing and Foundry 14.361 CSS: 124 scenarios × 4 themes × 3 widths × 2 merge states = 2,976 presentations. Original buttons, hidden/disabled states, GM/attacker/defender/observer source branches and long-title wrapping are checked.
- The actual HTML exporter runs against mocked documents/save behavior for five representative messages in each theme. The resulting files retain OP markers, both DT badges, fonts and CSS. The real render limiter's batch/all restoration is also exercised with native OP postprocessing.
- Font checks include heading-only/body-only settings and preservation of generic dice, code, icons and sender fonts. Negative cases retain hidden/external/foreign payload boundaries.

These are isolated integration tests, not a live Foundry 4.1.0 world test. Simultaneous client permission transport, reaction sockets, actual HP application, and every third-party combination are not claimed as verified. The separate live comparison used Selector 4.0.0 / Interface 0.1.1 and confirmed ordinary DT rolls work with all original modules active; OP's request-command parsing defect was not patched here.
