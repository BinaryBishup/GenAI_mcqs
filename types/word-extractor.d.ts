declare module "word-extractor" {
  class Document {
    getBody(): string;
    getHeaders(): string;
    getFooters(): string;
  }
  export default class WordExtractor {
    extract(input: Buffer | string): Promise<Document>;
  }
}
