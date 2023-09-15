/* globals
documents,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FLAGS } from "./const.js";

export class TerrainModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    const CHOICES = FLAGS.ANCHOR;
    return {
//      _id: new fields.DocumentIdField(),
      // activeEffect: new fields.EmbeddedDocumentField(foundry.documents.BaseActiveEffect, { required: false, initial: undefined }),
      anchor: new fields.NumberField({
        required: false,
        choices: Object.values(CHOICES),
        initial: CHOICES.RELATIVE_TO_TERRAIN }),
      color: new fields.ColorField({ required: true, initial: "#FFFFFF" }),
      description: new fields.HTMLField({required: true, nullable: true, label: "DND5E.Description"}),
//       description: new fields.SchemaField({
//         value: new fields.HTMLField({required: true, nullable: true, label: "DND5E.Description" }),
//         chat: new fields.HTMLField({required: true, nullable: true, label: "DND5E.DescriptionChat" }),
//         unidentified: new fields.HTMLField({
//           required: true, nullable: true, label: "DND5E.DescriptionUnidentified" })
//       }),
//      img: new fields.FilePathField({ required: false, categories: ["IMAGE"] }),
//      name: new fields.StringField({ required: true, blank: false, initial: "Terrain" }),
      offset: new fields.NumberField({ required: true, initial: 0 }),
      rangeBelow: new fields.NumberField({ required: true, max: 0, initial: 0 }),
      rangeAbove: new fields.NumberField({ required: true, min: 0, initial: 0 }),
//      userVisible: new fields.BooleanField({ required: true, initial: false }),
      _pixelValue: new fields.NumberField({ required: true, min: 1, max: 31 })
    };
  }
}
