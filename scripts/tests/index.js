/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Import tests
import { registerTests as registerCutawayHandlerTests } from "./CutawayHandler.test.js";

export function registerTests(quench) {
  registerCutawayHandlerTests(quench);
}
