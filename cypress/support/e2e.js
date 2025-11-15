Cypress.Commands.add("loginAsAdmin", () => {
  cy.intercept("POST", "/api/login", {
    statusCode: 200,
    body: {
      token: "jwt-token",
      user: { id: 1, name: "Admin", email: "admin@euro.one", role: "admin", clientId: null },
    },
  }).as("loginRequest");

  cy.intercept("GET", "/api/session", {
    statusCode: 200,
    body: { user: { id: 1, name: "Admin", email: "admin@euro.one", role: "admin", clientId: null } },
  }).as("sessionRequest");

  cy.intercept("GET", "/api/clients", {
    statusCode: 200,
    body: { clients: [{ id: 10, name: "Cliente Demo", deviceLimit: 50, userLimit: 20 }] },
  }).as("clientsRequest");

  cy.visit("/login");
  cy.get("input[type='text']").type("admin@euro.one");
  cy.get("input[type='password']").type("senhaSecreta");
  cy.get("button[type='submit']").click();
  cy.wait("@loginRequest");
  cy.url().should("include", "/home");
});
