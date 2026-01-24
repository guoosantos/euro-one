import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { confirmDeleteAction } from "../src/lib/confirm-delete.js";

describe("confirmDeleteAction", () => {
  it("não chama onDelete quando confirmação é cancelada", async () => {
    let deleteCalls = 0;
    const confirmDelete = async () => false;
    const onDelete = async () => {
      deleteCalls += 1;
    };

    const confirmed = await confirmDeleteAction({
      confirmDelete,
      title: "Excluir",
      message: "Confirmar exclusão?",
      confirmLabel: "Excluir",
      onDelete,
    });

    assert.equal(confirmed, false);
    assert.equal(deleteCalls, 0);
  });

  it("chama onDelete quando confirmação é aceita", async () => {
    let deleteCalls = 0;
    const confirmDelete = async ({ onConfirm }) => {
      await onConfirm();
      return true;
    };
    const onDelete = async () => {
      deleteCalls += 1;
    };

    const confirmed = await confirmDeleteAction({
      confirmDelete,
      title: "Excluir",
      message: "Confirmar exclusão?",
      confirmLabel: "Excluir",
      onDelete,
    });

    assert.equal(confirmed, true);
    assert.equal(deleteCalls, 1);
  });
});
