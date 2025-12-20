# Fluxo de veículo x device no Euro-One

O sistema é centrado na placa do veículo. Todo monitoramento, relatório e autorização parte do veículo e dos dispositivos vinculados a ele.

## Cadastros obrigatórios
1. **Chip**: cadastrado apenas no Postgres.
2. **Device (equipamento)**: cadastrado no Euro-One e replicado imediatamente para o Traccar (`tc_devices`).
3. **Veículo (placa)**: cadastrado no Euro-One, sempre associado a um cliente.

## Vínculos
- **Chip → Device**: vínculo feito no Postgres para registrar o SIM usado pelo equipamento.
- **Device → Veículo**: um veículo pode ter vários devices ativos ao mesmo tempo.

## Monitoramento e relatórios
- A UI lista **veículos** (placas). Os devices servem apenas para alimentar a telemetria do veículo.
- A posição exibida é do *device principal*, definido automaticamente pela posição mais recente (`max(devicetime)`).
- Quando houver múltiplos devices, os atributos crus (raw) de cada posição são mantidos para inspeção.
- Relatórios também recebem a placa; o backend resolve os devices vinculados para consultar o Traccar no período solicitado.

## Regras de exibição
- Um veículo só aparece como rastreado quando existir no Postgres **e** tiver pelo menos um device vinculado. Caso não haja telemetria, pode ser mostrado como "sem rastreador" conforme a tela.
- Toda criação ou edição deve manter o vínculo consistente para que a telemetria siga a placa correta.
