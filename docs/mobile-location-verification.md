# Mobile location picker and field order

Prepared October 14, 2026 for the reported iPhone Firefox/theme 1 clipping.

The old Google `PlaceAutocompleteElement` changes into an internal full-screen
dialog on phones. Inspection showed fixed positioning at the layout viewport's
origin and full layout height. Desktop iPhone emulation did not reproduce the
physical keyboard clipping; it cannot emulate iOS keyboard panning completely.

The replacement uses Google's supported Autocomplete Data API with a native
combobox. Mobile suggestions participate in document layout and are bounded by
the visual viewport. Resize events account for both keyboard height and viewport
offset. The visibility calculation reserves room for the first result, including
long wrapping addresses. Mouse/keyboard controls, manual input, Canadian result
restriction, session tokens, required attribution and selected coordinates are
preserved. Obsolete suggestion and detail responses cannot overwrite newer input.
Movie title and location exchange their existing positions in both themes.

Validation:

- 102 existing application tests pass; TypeScript and production build pass.
- Controlled browser checks pass in Chromium, Firefox and WebKit/iPhone emulation.
  Both themes were checked at 393×360, 320×320, 844×360 and 1280×800.
- Checked input/first-option visibility, selection, movie-before-location order,
  horizontal overflow, stale responses, arrows/Enter, Escape and manual entry.
- Google's real data API returned five Waterloo suggestions; selecting the first
  returned formatted address `Waterloo, ON` and coordinates. This was tested with
  the site's existing public browser configuration, without changing key rules.
- Localhost requests are rejected by Google's existing referrer restrictions.
  The local layout tests explicitly use controlled suggestions; they are not
  evidence of real Google responses from localhost.
- Confirm the real on-screen keyboard on the user's iPhone Firefox after release.

No AWS configuration or operating-window change is included.

API references: [Autocomplete Data API](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data),
[visual viewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport),
[official attribution assets](https://developers.google.com/maps/documentation/javascript/policies).
