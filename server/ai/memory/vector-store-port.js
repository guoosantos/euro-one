export class VectorStorePort {
  async upsertDocuments() {
    throw new Error("VectorStorePort.upsertDocuments precisa ser implementado.");
  }

  async similaritySearch() {
    throw new Error("VectorStorePort.similaritySearch precisa ser implementado.");
  }
}

