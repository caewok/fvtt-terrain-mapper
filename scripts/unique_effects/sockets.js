/* globals
foundry,
fromUuid,
fromUuidSync,
game,
Hooks,
socketlib
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SOCKETS } from "../const.js";
import { log } from "../util.js";

// ----- NOTE: Set up sockets so GM can create or modify effects on tokens ----- //
// Hooks.once("socketlib.ready", () => {
//   SOCKETS.socket ??= socketlib.registerModule(MODULE_ID);
//   SOCKETS.socket.register("createDocument", createDocument);
//   SOCKETS.socket.register("updateDocument", updateDocument);
//   SOCKETS.socket.register("deleteDocument", deleteDocument);
//   SOCKETS.socket.register("createEmbeddedDocuments", createEmbeddedDocuments);
//   SOCKETS.socket.register("updateEmbeddedDocuments", updateEmbeddedDocuments);
//   SOCKETS.socket.register("deleteEmbeddedDocuments", deleteEmbeddedDocuments);
// });

/**
 * Socket function: createDocument
 * GM creates an document such as an item
 * @param {string} classPath    Path to document to create. E.g. "CONFIG.Item.documentClass"
 * @param {string} [uuid]       Example document to use
 * @param {object} [data]       Changes from the example document
 * @returns {string} uuid of the item created
 */
export async function createDocument(classPath, uuid, data) {
  if ( !game.user.isGM ) return; // return SOCKETS.socket.executeAsGM("createDocument", classPath, uuid, data);
  const cl = foundry.utils.getProperty(window, classPath);
  if ( !cl ) return;

  // Merge the example document with any additional data.
  let exampleDoc;
  if ( uuid ) {
    exampleDoc = await fromUuid(uuid);
    exampleDoc = exampleDoc?.toObject();
  }
  const baseData = exampleDoc ?? data ?? {};
  if ( exampleDoc && data ) foundry.utils.mergeObject(baseData, data);

  // Create the new document.
  const doc = await cl.create(baseData);
  return doc.uuid;
}

/**
 * Socket function: updateDocument
 * GM updates an document such as an item
 * @param {string} uuid   Container to update
 * @param {object} data   Data used to update the document
 */
export async function updateDocument(uuid, data) {
  if ( !game.user.isGM ) return; // return SOCKETS.socket.executeAsGM("updateDocument", uuid, data);
  const doc = fromUuidSync(uuid);
  if ( !doc ) return;
  await doc.update(data);
}

/**
 * Socket function: deleteDocument
 * GM deletes a document such as an item
 * @param {string} uuid   Item to delete
 * @param {object} data   Data used to create the effect
 */
export async function deleteDocument(uuid) {
  if ( !game.user.isGM ) return; // return SOCKETS.socket.executeAsGM("deleteDocument", uuid);
  const doc = fromUuidSync(uuid);
  if ( !doc ) return;
  await doc.delete();
}

/**
 * Socket function: createEmbeddedDocuments
 * GM creates the embedded documents in a collection
 * Document should already exist somewhere else so its data can be copied.
 * @param {string} uuid           Container that embeds the documents
 * @param {string} embeddedName   Name of the embed
 * @param {string[]} [uuids]      Example documents to use
 * @param {object[]} [data]       Changes from the example document

 * @returns {string[]} The created effect uuids.
 */
export async function createEmbeddedDocuments(containerUuid, embeddedName, uuids = [], data = []) {
  const numDocs = uuids.length || data.length;
  if ( !numDocs ) return;
  if ( !game.user.isGM ) return; // return SOCKETS.socket.executeAsGM("createEmbeddedDocuments", containerUuid, embeddedName, uuids, data);

  // Locate container in which to store the embedded documents.
  const container = await fromUuid(containerUuid);
  if ( !container ) return [];

  // Locate the example documents, if any.
  const exampleDocs = Array(numDocs);
  for ( let i = 0; i < numDocs; i += 1 ) exampleDocs[i] = await fromUuid(uuids[i]);


  // const exampleDocs = (await Promise.allSettled(promises)).map(p => p.value);

  // Merge the example documents with any additional data.
  const baseData = Array(numDocs);
  for ( let i = 0; i < numDocs; i += 1 ) {
    const exampleDoc = exampleDocs[i]?.toObject();
    const uuid = uuids[i];
    const datum = data[i];
    const baseDatum = baseData[i] = exampleDoc ?? datum ?? {};
    if ( exampleDoc && datum ) foundry.utils.mergeObject(baseDatum, datum);
    baseData[i] = baseDatum;
  }

  // Construct the new embeds.
  log("Socket|createEmbeddedDocuments|creating embedded document");
  const newDocs = await container.createEmbeddedDocuments(embeddedName, baseData);
  log("Socket|createEmbeddedDocuments|finished creating embedded document");
  return newDocs.map(doc => doc.uuid);
}

/**
 * Socket function: updateEmbeddedDocuments
 * GM updates the embedded documents in a collection
 * Document should already exist somewhere else so its data can be copied.
 * @param {string} uuid           Container that embeds the documents
 * @param {string} embeddedName   Name of the embed
 * @param {string[]} data         Data used to update the embedded docs
 */
export async function updateEmbeddedDocuments(containerUuid, embeddedName, data) {
  if ( !game.user.isGM ) return; // return SOCKETS.socket.executeAsGM("updateEmbeddedDocuments", containerUuid, embeddedName, data);
  if ( !data.length ) return;
  const container = fromUuidSync(containerUuid);
  if ( !container ) return [];
  await container.updateEmbeddedDocuments(embeddedName, data);
}

/**
 * Socket function: deleteEmbeddedDocuments
 * GM deletes the embedded documents from a collection
 * Document should already exist somewhere else so its data can be copied.
 * @param {string} uuid           Container that embeds the documents
 * @param {string} embeddedName   Name of the embed
 * @param {string[]} ids          Document ids to be deleted
 */
export async function deleteEmbeddedDocuments(containerUuid, embeddedName, ids) {
  if ( !game.user.isGM ) return; // return SOCKETS.socket.executeAsGM("deleteEmbeddedDocuments", containerUuid, embeddedName, ids);
  if ( !ids.length ) return;
  const container = fromUuidSync(containerUuid);
  if ( !container ) return [];
  await container.deleteEmbeddedDocuments(embeddedName, ids);
}
