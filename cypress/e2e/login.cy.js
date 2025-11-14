describe("Fluxos principais", () => {
  beforeEach(() => {
    cy.viewport(1280, 720);
  });

  it("realiza login via backend e carrega dashboard", () => {
    cy.intercept("POST", "/api/login", {
      statusCode: 200,
      body: {
        token: "jwt-token",
        user: { id: 1, name: "Admin", email: "admin@euro.one", role: "admin" },
      },
    }).as("loginRequest");

    cy.intercept("GET", "/api/session", {
      statusCode: 200,
      body: { user: { id: 1, name: "Admin", email: "admin@euro.one", role: "admin" } },
    }).as("sessionRequest");

    cy.intercept("GET", "/api/clients", {
      statusCode: 200,
      body: { clients: [{ id: 10, name: "Cliente Demo", deviceLimit: 50, userLimit: 20 }] },
    }).as("clientsRequest");

    cy.visit("/login");
    cy.contains("Euro One");
    cy.get("input[type='text']").type("admin@euro.one");
    cy.get("input[type='password']").type("senhaSecreta");
    cy.get("button[type='submit']").click();

    cy.wait("@loginRequest");
    cy.url().should("include", "/home");

    cy.intercept("GET", "/api/devices", {
      statusCode: 200,
      body: [{ id: 1, name: "Caminhão 01" }],
    }).as("devicesRequest");

    cy.visit("/dashboard");
    cy.wait("@devicesRequest");
    cy.contains("Veículos monitorados");
  });

  it("permite cadastrar clientes pelo painel administrativo", () => {
    cy.loginAsAdmin();

    cy.intercept("GET", "/api/clients", {
      statusCode: 200,
      body: { clients: [] },
    }).as("clientsEmpty");

    cy.visit("/admin/clients");
    cy.wait("@clientsEmpty");

    cy.intercept("POST", "/api/clients", {
      statusCode: 201,
      body: { client: { id: 99, name: "Nova Frota", deviceLimit: 10, userLimit: 5 } },
    }).as("createClient");

    cy.intercept("GET", "/api/clients", {
      statusCode: 200,
      body: { clients: [{ id: 99, name: "Nova Frota", email: "contato@nova.com", deviceLimit: 10, userLimit: 5 }] },
    }).as("clientsReload");

    cy.get("input[type='text']").first().clear().type("Nova Frota");
    cy.get("input[type='email']").clear().type("contato@nova.com");
    cy.get("input[type='password']").clear().type("senha123");
    cy.get("button[type='submit']").contains("Adicionar cliente").click();

    cy.wait("@createClient");
    cy.wait("@clientsReload");
    cy.contains("Cliente criado com sucesso");
    cy.contains("Nova Frota");
  });
});
