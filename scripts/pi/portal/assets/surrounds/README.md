# TV surround previews

These transparent PNGs are offscreen Qt renders of the actual standard-screen
native surrounds, not separate illustrations. Generated on 7 October 2026.

The four plain sets use the cabinet, fascia, controls and screen geometry from
`qml/TelevisionScreen.qml`, with playback and OSD excluded. The decorative sets
render `qml/DinosaurDenSurround.qml`, `qml/OceanClubSurround.qml` and
`qml/FindingNemo.qml` directly, including their artwork dependencies.

Regenerate these previews when changing the native surround designs. Render at
1072 × 816 with an empty black picture aperture; retain the transparent margin.
