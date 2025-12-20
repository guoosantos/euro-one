# Fluxo de veículo, chip e equipamento

## Criação e vinculação
- **Equipamento (device)**: criado no Euro One e replicado no Traccar (tc_devices). Pode ter chip vinculado.
- **Chip**: criado apenas no Postgres (Euro One) e pode ser associado a um equipamento.
- **Veículo (placa)**: cadastrado no Euro One com `clientId` do dono.
- **Vínculos**:
  - Equipamento → Veículo (campo `vehicleId` / relação principal usada no monitoramento).
  - Chip → Equipamento (`chipId` no device e `deviceId` no chip).

## Visualização por placa
- Monitoramento e relatórios listam **veículos**. O dispositivo principal é escolhido pela posição mais recente (`deviceTime`).
- Um veículo pode ter múltiplos devices reportando na mesma placa. A camada de visualização usa o mais recente e mantém os demais como alternativos.
- Veículos sem equipamento podem ser cadastrados, mas não aparecem no monitoramento até terem ao menos um device vinculado.

## Multi-tenant
- Usuários comuns só acessam recursos do próprio `clientId`.
- Administradores podem listar e filtrar por qualquer cliente, mantendo validações de permissão em cada operação (vehicles, devices, chips e geofences).
