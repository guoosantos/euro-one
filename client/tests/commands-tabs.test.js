import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMMAND_TABS, filterCommandTabs } from "../src/pages/commands-tabs.js";

describe("filterCommandTabs", () => {
  it("retorna apenas as abas com canShow true", () => {
    const visible = new Set(["list", "create"]);
    const getPermission = ({ subKey }) => ({ canShow: visible.has(subKey) });
    const tabs = filterCommandTabs(getPermission);
    assert.deepEqual(tabs.map((tab) => tab.id), ["list", "create"]);
  });

  it("mantém todas as abas quando todas estão visíveis", () => {
    const getPermission = () => ({ canShow: true });
    const tabs = filterCommandTabs(getPermission);
    assert.deepEqual(tabs.map((tab) => tab.id), COMMAND_TABS.map((tab) => tab.id));
  });
});
