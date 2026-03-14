export class OperationalEventStreamPort {
  async publish() {
    throw new Error("OperationalEventStreamPort.publish precisa ser implementado.");
  }

  async subscribe() {
    throw new Error("OperationalEventStreamPort.subscribe precisa ser implementado.");
  }
}

