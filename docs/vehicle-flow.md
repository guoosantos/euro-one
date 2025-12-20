# Fluxo por veículo (placa) no Euro One

## Princípios
- Toda visualização e monitoramento acontecem por **veículo/placa**, não por equipamento isolado.
- Um veículo só aparece para o cliente (listas, monitoramento, relatórios) quando:
  - existe cadastrado no Postgres **e**
  - possui pelo menos um equipamento vinculado.
- Se não houver equipamento vinculado, o veículo é apenas um cadastro administrativo e fica oculto para o cliente até que o vínculo seja feito.

## Fluxo obrigatório
1. **Criar equipamento (device)** no Euro One — cria automaticamente no Traccar e começa a reportar.
2. **Criar chip** — permanece apenas no Postgres.
3. **Vincular chip → device** no Postgres.
4. **Criar veículo (placa)** no Postgres já escolhendo o **cliente dono (clientId)**.
5. **Vincular device → veículo** no Postgres.
6. Visualização/monitoramento/relatórios sempre usam a placa; a telemetria vem do(s) device(s) vinculados.

## Múltiplos devices por placa
- Um veículo pode ter mais de um equipamento.
- O **device principal** é escolhido automaticamente pelo último sinal recebido (`deviceTime` > `fixTime` > `serverTime`).
- O principal é usado como fonte padrão de telemetria/posição no monitoramento e nas telas de detalhes.

## Permissões
- **Cliente**: vê somente os veículos do próprio `clientId`, em modo leitura e apenas quando possuem equipamento vinculado.
- **Admin/Euro**: pode ver e editar, inclusive veículos ainda sem equipamento (para vincular), e possui aba extra de administração na página do veículo.
