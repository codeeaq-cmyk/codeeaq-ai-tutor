// The Ceeq logo is one picture, kept at public/logo-cq.svg. Everything that
// shows it (the page headers, Ceeq herself in a lesson, the browser tab) takes
// it from here, so replacing that file changes it everywhere.
//
// Two places cannot take an SVG: the icon on an iPhone's home screen, and the
// tab icon in some browsers. For those the same picture is kept drawn as PNGs
// beside it (the first on a white square with room for the rounded corners).
// If the logo changes, they must be drawn again from it.

export const LOGO_SRC = "/logo-cq.svg";
export const LOGO_PNG = "/logo-cq-192.png";
export const LOGO_APPLE = "/logo-cq-180.png";
