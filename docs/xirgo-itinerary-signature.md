# Xirgo – Assinatura do Itinerário (Sensor_U32UserDefined0)

Objetivo: destravar o latch (`alvoTravado`) **somente** quando um novo itinerário completo for embarcado e a assinatura U32 for atualizada pelo backend.

## Variáveis persistentes

- `lastSig` (U32): inicia em `0`.
- `alvoTravado`: já existente no script.

## Leitura do sensor (U32)

```c
// leitura do sensor configurável (U32)
sensorSig = read(Sensor_U32UserDefined0);
```

## Lógica periódica (timer/loop)

```c
// executa periodicamente
sensorSig = read(Sensor_U32UserDefined0);
if (sensorSig != 0 && sensorSig != lastSig) {
  lastSig = sensorSig;
  alvoTravado = 0; // destrava latch
}
```

## Regras de latch

```c
if (alvoTravado == 1) {
  // manter saída GND e NÃO destravar offline
} else {
  // lógica normal de abertura
}
```
