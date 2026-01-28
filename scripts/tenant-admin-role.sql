-- Exemplo seguro para promover um usuário a ADMIN DO CLIENTE (tenant_admin).
-- Substitua os valores conforme o seu ambiente antes de executar.
BEGIN;

-- Promove um usuário específico ao papel tenant_admin.
UPDATE "User"
SET role = 'tenant_admin'
WHERE id = 'USER_ID_AQUI';

COMMIT;
