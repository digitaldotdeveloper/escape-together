/* Where the game is served from.
 *
 * The same files run at the root of a local Node server and inside a project
 * subpath on GitHub Pages (/escape-together/), so nothing may be written as an
 * absolute "/assets/..." path. Working it out from this module's own URL costs
 * one line and removes a whole class of "works locally, 404s when deployed".
 */
export const BASE = new URL('../', import.meta.url).href;

export const asset = (p) => BASE + 'assets/' + p;
