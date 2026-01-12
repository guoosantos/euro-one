import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFriendlyName,
  sanitizeFriendlyName,
  truncateName,
} from "../services/xdm/xdm-name-utils.js";
import { selectGeozoneGroupMatch } from "../services/xdm/geozone-group-sync-service.js";

test("sanitizeFriendlyName remove quebras de linha", () => {
  const cleaned = sanitizeFriendlyName("Cliente\n\n  Nome\r\nTeste");
  assert.equal(cleaned, "Cliente Nome Teste");
});

test("buildFriendlyName aplica truncamento", () => {
  const name = buildFriendlyName(["Cliente Muito Grande", "Geofence"], { maxLen: 18 });
  assert.equal(name, "Cliente Muito Gran");
  assert.equal(truncateName("ABCDE", 3), "ABC");
});

test("selectGeozoneGroupMatch usa notes para desambiguar", () => {
  const results = [
    { id: 1, name: "Cliente A - Itinerário", notes: "itineraryId=it-1, clientId=client-1" },
    { id: 2, name: "Cliente A - Itinerário", notes: "itineraryId=it-2, clientId=client-1" },
  ];
  const match = selectGeozoneGroupMatch({
    results,
    name: "Cliente A - Itinerário",
    itineraryId: "it-2",
    clientId: "client-1",
  });
  assert.equal(match?.id, 2);
});

test("selectGeozoneGroupMatch retorna primeiro quando notes não batem", () => {
  const results = [
    { id: 10, name: "Grupo", notes: "itineraryId=it-1" },
    { id: 11, name: "Grupo", notes: "itineraryId=it-2" },
  ];
  const match = selectGeozoneGroupMatch({ results, name: "Grupo", itineraryId: "it-3" });
  assert.equal(match?.id, 10);
});
