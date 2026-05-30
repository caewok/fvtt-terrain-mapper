/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/* Options class

Smarter handling for instantiated class options.
Set default values or callback using the constructor.

*/

export class OptionsObject {
  
  #defaultOpts;
  
  #currentOpts = {};
  
  constructor(opts) {
    this.#defaultOpts = { ...opts };
        
    for ( const [key, value] of Object.entries(opts) ) {
      this.#currentOpts[key] = value;
    
      if ( typeof value === "function" ) {
				Object.defineProperties(this, {
					[key]: {
						get: () => typeof this.#currentOpts[key] === "function" ? this.#currentOpts[key]() : this.#currentOpts[key],
						set: value => {
						  this.#currentOpts[key] = typeof value === "undefined" ? this.#defaultOpts[key] : value;
						},
						enumerable: true,
					}
				});
      } else {
				Object.defineProperties(this, {
					[key]: {
						get: () => this.#currentOpts[key],
						set: value => {
						  this.#currentOpts[key] = typeof value === "undefined" ? this.#defaultOpts[key]  : value;
						},
						enumerable: true,
					}
				});      
      }
    }
  }
  
  get config() { 
    const cfg = {};
    for ( const [key, value] of Object.entries(this) ) cfg[key] = value; // Trigger any callbacks by using the getter.
    return cfg;
  }
  
  set config(cfg = {}) {
    foundry.utils.mergeObject(this.#currentOpts, cfg, { inplace: true, insertKeys: false })
  }
  
  get defaults() {
    const cfg = {};
    for ( const [key, value] of Object.entries(this.#defaultOpts) ) cfg[key] = value;
    return cfg;
  }
  
  restoreDefaults() { this.#currentOpts = { ...this.#defaultOpts }; }
}


/* Usage
options = new OptionsObject({
  threshold: 0.75,
  viewpoint: () => 0.5,
  angle: true,
});

options.threshold = 0.5
options.viewpoint = 0.2

options.config = { threshold: 0.4, viewpoint: false };
*/