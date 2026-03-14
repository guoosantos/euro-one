export class AIProvider {
  constructor(name) {
    this.name = name;
  }

  isConfigured() {
    return true;
  }

  async generate() {
    throw new Error("AIProvider.generate precisa ser implementado");
  }
}

