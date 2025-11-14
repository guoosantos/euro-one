describe('Login flow', () => {
  it('renders login form', () => {
    cy.visit('/login');
    cy.contains('Euro One');
    cy.get('input[type="text"]').should('exist');
    cy.get('input[type="password"]').should('exist');
  });
});
