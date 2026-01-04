import assert from "node:assert/strict";
import test from "node:test";
import { formatFullAddress, ensurePositionAddress } from "../utils/address.js";

const SAMPLE_PARTS = {
  street: "Av. Miguel Perrela",
  house_number: "766",
  suburb: "Castelo",
  city: "Belo Horizonte",
  state_code: "mg",
  postcode: "31330290",
  country: "Brasil",
};

test("formats Brazilian address parts in the expected compact order", () => {
  const formatted = formatFullAddress({ addressParts: SAMPLE_PARTS });
  assert.equal(formatted, "Av. Miguel Perrela, 766 - Castelo Belo Horizonte-MG, 31330-290");
});

test("removes trailing country names and handles missing fields gracefully", () => {
  const formatted = formatFullAddress("Rua Sem Nome, 123, Bairro, Cidade, Estado, Brasil");
  assert.equal(formatted, "Rua Sem Nome, 123, Bairro, Cidade, Estado");

  const fallback = formatFullAddress({ addressParts: { city: "Cidade", state: "SP" } });
  assert.equal(fallback, "Cidade-SP");
});

test("formats Nominatim payload into Brazilian address layout", () => {
  const nominatimPayload = {
    address: {
      road: "Avenida Paulista",
      house_number: "1000",
      suburb: "Bela Vista",
      city: "São Paulo",
      state_code: "SP",
      postcode: "01310000",
      country: "Brazil",
    },
  };
  const formatted = formatFullAddress(nominatimPayload);
  assert.equal(formatted, "Avenida Paulista, 1000 - Bela Vista São Paulo-SP, 01310-000");
});

test("removes duplicated separators when UF appears twice", () => {
  const formatted = formatFullAddress("Rua das Flores, 10 - Centro - SP, SP");
  assert.equal(formatted, "Rua das Flores, 10 - Centro SP");
});

test("sets fullAddress when enriching a position", async () => {
  const position = {
    latitude: -19.0,
    longitude: -43.0,
    address: { addressParts: SAMPLE_PARTS },
  };
  const enriched = await ensurePositionAddress(position);
  assert.ok(enriched.fullAddress?.includes("Av. Miguel Perrela"), "fullAddress should be defined");
});
