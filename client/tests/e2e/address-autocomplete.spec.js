import { test, expect } from "@playwright/test";

const USERNAME = process.env.E2E_USER;
const PASSWORD = process.env.E2E_PASS;

const GEOCODE_RESULTS = [
  {
    place_id: "place-123",
    lat: "-20.12345",
    lon: "-44.12345",
    display_name: "Rua Teste, 123 - Sao Joaquim de Bicas - MG, Brasil",
    address: {
      road: "Rua Teste",
      house_number: "123",
      suburb: "Centro",
      city: "Sao Joaquim de Bicas",
      state: "MG",
      postcode: "32920-000",
    },
  },
  {
    place_id: "place-456",
    lat: "-20.12000",
    lon: "-44.12000",
    display_name: "Avenida Central - Sao Joaquim de Bicas - MG, Brasil",
    address: {
      road: "Avenida Central",
      suburb: "Centro",
      city: "Sao Joaquim de Bicas",
      state: "MG",
      postcode: "32920-000",
    },
  },
];

async function login(page) {
  if (!USERNAME || !PASSWORD) {
    throw new Error("E2E_USER/E2E_PASS env vars are required to run this test.");
  }

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[autocomplete="username"]', USERNAME);
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');

  const loginResult = await Promise.race([
    page.waitForURL("**/home", { timeout: 20_000 }).then(() => "ok"),
    page.waitForSelector(".border-red-500\\/40", { timeout: 20_000 }).then(() => "error"),
  ]);
  if (loginResult !== "ok") {
    const errorText = await page.locator(".border-red-500\\/40").textContent();
    throw new Error(`Login failed: ${errorText || "unknown error"}`);
  }
  await expect(page.locator("#root")).toBeVisible();
}

async function mockGeocode(page, mode = "success") {
  await page.route("**/nominatim.openstreetmap.org/search**", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    if (mode === "error") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Erro no geocoder" } }),
      });
    }
    if (mode === "empty") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(GEOCODE_RESULTS),
    });
  });
}

function expectNoObjectObject(locator) {
  return expect(locator).not.toContainText("[object Object]");
}

const TASK_FIXTURE = {
  id: "task-1",
  clientId: "client-1",
  clientName: "Cliente Teste",
  clientDocument: "00.000.000/0000-00",
  contactName: "Contato",
  contactChannel: "3199999999",
  address: "Rua Antiga, 100",
  referencePoint: "",
  latitude: -20.11111,
  longitude: -44.11111,
  geoFenceId: "place-old",
  serviceReason: "Teste",
  status: "pendente",
  type: "Instalação",
  startTimeExpected: new Date().toISOString(),
  vehicleId: "vehicle-1",
  category: "request",
};

const VEHICLE_FIXTURE = {
  id: "vehicle-1",
  plate: "AAA-1234",
  name: "Carro Teste",
  updatedAt: new Date().toISOString(),
};

function mockServiceRequestsEndpoints(page) {
  return page.route("**/core/tasks**", async (route, request) => {
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tasks: [TASK_FIXTURE] }),
      });
    }
    if (request.method() === "PUT") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, task: { id: TASK_FIXTURE.id } }),
      });
    }
    return route.continue();
  });
}

function mockVehicles(page) {
  return page.route("**/core/vehicles**", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([VEHICLE_FIXTURE]),
    });
  });
}

function mockTechnicians(page) {
  return page.route("**/core/technicians**", async (route, request) => {
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    }
    if (request.method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, item: { id: "tech-1" } }),
      });
    }
    return route.continue();
  });
}

function mockDevices(page) {
  return page.route("**/core/devices**", async (route, request) => {
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
}

test("service requests: autocomplete shows suggestions and persists metadata", async ({ page }) => {
  await mockGeocode(page, "success");
  await mockServiceRequestsEndpoints(page);
  await mockVehicles(page);
  await mockTechnicians(page);

  await login(page);
  await page.goto("/service-requests", { waitUntil: "domcontentloaded" });

  const row = page.locator("tr", { hasText: TASK_FIXTURE.address });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  const drawer = page.locator(".fixed.inset-0");
  await expect(drawer).toBeVisible();

  const addressInput = drawer.getByPlaceholder("Buscar endereço");
  await addressInput.fill("sao joaquim de bicas");

  const suggestions = page.locator(".map-search-suggestions");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expectNoObjectObject(suggestions);
  await expect(suggestions).toContainText("Sao Joaquim de Bicas");

  await suggestions.locator("li").first().click();
  await expect(addressInput).toHaveValue(GEOCODE_RESULTS[0].display_name);

  const updateRequestPromise = page.waitForRequest(
    (request) => request.url().includes("/core/tasks/") && request.method() === "PUT",
  );
  await drawer.getByRole("button", { name: "Atualizar" }).click();
  const updateRequest = await updateRequestPromise;
  const payload = updateRequest.postDataJSON();

  expect(payload.address).toBe(GEOCODE_RESULTS[0].display_name);
  expect(payload.latitude).toBeCloseTo(Number(GEOCODE_RESULTS[0].lat), 5);
  expect(payload.longitude).toBeCloseTo(Number(GEOCODE_RESULTS[0].lon), 5);
  expect(payload.geoFenceId).toBe(GEOCODE_RESULTS[0].place_id);
});

test("technicians: autocomplete shows suggestions and persists metadata", async ({ page }) => {
  await mockGeocode(page, "success");
  await mockTechnicians(page);
  await mockDevices(page);

  await login(page);
  await page.goto("/technicians", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Novo técnico" }).click();

  const drawer = page.locator(".fixed.inset-0");
  await expect(drawer).toBeVisible();

  await drawer.getByLabel(/Nome/i).fill("Tecnico E2E");
  await drawer.getByLabel(/E-mail/i).fill("tecnico.e2e@example.com");

  const addressInput = drawer.getByPlaceholder("Buscar endereço");
  await addressInput.fill("sao joaquim de bicas");

  const suggestions = page.locator(".map-search-suggestions");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expectNoObjectObject(suggestions);

  await suggestions.locator("li").first().click();
  await expect(addressInput).toHaveValue(GEOCODE_RESULTS[0].display_name);

  const createRequestPromise = page.waitForRequest(
    (request) => request.url().includes("/core/technicians") && request.method() === "POST",
  );
  await drawer.getByRole("button", { name: "Cadastrar técnico" }).click();
  const createRequest = await createRequestPromise;
  const payload = createRequest.postDataJSON();

  expect(payload.addressSearch).toBe(GEOCODE_RESULTS[0].display_name);
  expect(payload.latitude).toBeCloseTo(Number(GEOCODE_RESULTS[0].lat), 5);
  expect(payload.longitude).toBeCloseTo(Number(GEOCODE_RESULTS[0].lon), 5);
  expect(payload.addressPlaceId).toBe(GEOCODE_RESULTS[0].place_id);
});

test("autocomplete shows empty state when no results", async ({ page }) => {
  await mockGeocode(page, "empty");
  await mockTechnicians(page);
  await mockDevices(page);

  await login(page);
  await page.goto("/technicians", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Novo técnico" }).click();

  const drawer = page.locator(".fixed.inset-0");
  const addressInput = drawer.getByPlaceholder("Buscar endereço");
  await addressInput.fill("sao joaquim de bicas");

  const suggestions = page.locator(".map-search-suggestions");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("Nenhum resultado encontrado");
});

test("autocomplete shows friendly error when provider fails", async ({ page }) => {
  await mockGeocode(page, "error");
  await mockTechnicians(page);
  await mockDevices(page);

  await login(page);
  await page.goto("/technicians", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Novo técnico" }).click();

  const drawer = page.locator(".fixed.inset-0");
  const addressInput = drawer.getByPlaceholder("Buscar endereço");
  await addressInput.fill("sao joaquim de bicas");

  const suggestions = page.locator(".map-search-suggestions");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("Não foi possível buscar endereço. Tente novamente.");
});
