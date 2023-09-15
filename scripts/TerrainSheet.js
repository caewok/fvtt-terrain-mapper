/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class TerrainSheet extends ItemSheet {

  async getData(options={}) {
    const context = await super.getData(options);
    context.description = {
      long: await TextEditor.enrichHTML(this.object.system.description.long, {
        async: true,
        secrets: this.object.isOwner,
        relativeTo: this.object
      }),
      short: await TextEditor.enrichHTML(this.object.system.description.short, {
        async: true,
        secrets: this.object.isOwner,
        relativeTo: this.object
      })
    };
    return context;
  }

}
